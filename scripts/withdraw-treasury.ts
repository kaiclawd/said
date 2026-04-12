/**
 * Withdraw SOL from SAID Protocol treasury PDA.
 * 
 * Usage:
 *   npx ts-node scripts/withdraw-treasury.ts <amount_in_sol> --keypair <path_to_authority_keypair>
 *   npx ts-node scripts/withdraw-treasury.ts all --keypair <path_to_authority_keypair>
 * 
 * The authority keypair must be: H8nKbwHTTmnjgnsvqxRDpoEcTkU6uoqs4DcLm4kY55Wp
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';

const SAID_PROGRAM_ID = new PublicKey('5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G');
const TREASURY_AUTHORITY = new PublicKey('H8nKbwHTTmnjgnsvqxRDpoEcTkU6uoqs4DcLm4kY55Wp');
const RPC_URL = 'https://newest-restless-mansion.solana-mainnet.quiknode.pro/af7d979a4ef8558eb0da3166819eac8af0d3dd2b';

// Anchor discriminator for withdraw_fees (first 8 bytes of sha256("global:withdraw_fees"))
// We need to compute this
import { createHash } from 'crypto';
const discriminator = createHash('sha256')
  .update('global:withdraw_fees')
  .digest()
  .slice(0, 8);

async function main() {
  const args = process.argv.slice(2);
  
  // Parse args
  let amountArg = args[0];
  let keypairPath = '';
  
  const keypairIdx = args.indexOf('--keypair');
  if (keypairIdx !== -1 && args[keypairIdx + 1]) {
    keypairPath = args[keypairIdx + 1];
  }
  
  if (!amountArg || !keypairPath) {
    console.log('Usage: npx ts-node scripts/withdraw-treasury.ts <amount_sol|all> --keypair <path>');
    console.log('');
    console.log('Examples:');
    console.log('  npx ts-node scripts/withdraw-treasury.ts 6.5 --keypair ~/authority-keypair.json');
    console.log('  npx ts-node scripts/withdraw-treasury.ts all --keypair ~/authority-keypair.json');
    process.exit(1);
  }
  
  // Load authority keypair
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  // Verify it's the right authority
  if (!authority.publicKey.equals(TREASURY_AUTHORITY)) {
    console.error(`❌ Wrong keypair! Expected authority: ${TREASURY_AUTHORITY.toBase58()}`);
    console.error(`   Got: ${authority.publicKey.toBase58()}`);
    process.exit(1);
  }
  
  console.log(`✅ Authority verified: ${authority.publicKey.toBase58()}`);
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Derive treasury PDA
  const [treasuryPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury')],
    SAID_PROGRAM_ID
  );
  
  console.log(`📦 Treasury PDA: ${treasuryPda.toBase58()}`);
  
  // Check treasury balance
  const treasuryBalance = await connection.getBalance(treasuryPda);
  console.log(`💰 Treasury balance: ${(treasuryBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  // Calculate rent-exempt minimum (estimate: ~0.001 SOL for small account)
  const rentExempt = await connection.getMinimumBalanceForRentExemption(
    8 + 32 + 8 + 1 // discriminator + authority pubkey + total_fees + bump (approximate Treasury struct size)
  );
  console.log(`🏠 Rent-exempt minimum: ${(rentExempt / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  const maxWithdrawable = treasuryBalance - rentExempt;
  console.log(`📤 Max withdrawable: ${(maxWithdrawable / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  if (maxWithdrawable <= 0) {
    console.error('❌ Nothing to withdraw (balance at or below rent minimum)');
    process.exit(1);
  }
  
  // Determine amount
  let withdrawAmount: number;
  if (amountArg === 'all') {
    withdrawAmount = maxWithdrawable;
  } else {
    withdrawAmount = Math.floor(parseFloat(amountArg) * LAMPORTS_PER_SOL);
    if (withdrawAmount > maxWithdrawable) {
      console.error(`❌ Requested ${amountArg} SOL but only ${(maxWithdrawable / LAMPORTS_PER_SOL).toFixed(4)} SOL available`);
      process.exit(1);
    }
  }
  
  console.log(`\n🔄 Withdrawing: ${(withdrawAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   → To: ${authority.publicKey.toBase58()}`);
  
  // Build instruction data: discriminator (8 bytes) + amount (8 bytes, little-endian u64)
  const data = Buffer.alloc(16);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(BigInt(withdrawAmount), 8);
  
  const ix = new TransactionInstruction({
    programId: SAID_PROGRAM_ID,
    keys: [
      { pubkey: treasuryPda, isSigner: false, isWritable: true },      // treasury
      { pubkey: authority.publicKey, isSigner: true, isWritable: true }, // authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data,
  });
  
  const tx = new Transaction().add(ix);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  
  tx.sign(authority);
  
  console.log('\n📡 Sending transaction...');
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  
  console.log(`📝 Signature: ${sig}`);
  console.log('⏳ Confirming...');
  
  await connection.confirmTransaction(sig, 'confirmed');
  
  const newBalance = await connection.getBalance(treasuryPda);
  const authorityBalance = await connection.getBalance(authority.publicKey);
  
  console.log(`\n✅ Withdrawal complete!`);
  console.log(`   Treasury remaining: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Authority balance: ${(authorityBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
}

main().catch((err) => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
