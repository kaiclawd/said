import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import fs from 'fs';
import { createHash } from 'crypto';

const SAID_PROGRAM_ID = new PublicKey('5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G');
const TREASURY_AUTHORITY = new PublicKey('H8nKbwHTTmnjgnsvqxRDpoEcTkU6uoqs4DcLm4kY55Wp');
const RPC_URL = 'https://newest-restless-mansion.solana-mainnet.quiknode.pro/af7d979a4ef8558eb0da3166819eac8af0d3dd2b';

const discriminator = createHash('sha256').update('global:withdraw_fees').digest().slice(0, 8);

const args = process.argv.slice(2);
const amountArg = args[0];
const keypairIdx = args.indexOf('--keypair');
const keypairPath = keypairIdx !== -1 ? args[keypairIdx + 1] : null;

if (!amountArg || !keypairPath) {
  console.log('Usage: node scripts/withdraw-treasury.mjs <amount_sol> --keypair <path>');
  process.exit(1);
}

const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

if (!authority.publicKey.equals(TREASURY_AUTHORITY)) {
  console.error(`Wrong keypair! Expected: ${TREASURY_AUTHORITY.toBase58()}, got: ${authority.publicKey.toBase58()}`);
  process.exit(1);
}

console.log(`✅ Authority: ${authority.publicKey.toBase58()}`);

const connection = new Connection(RPC_URL, 'confirmed');
const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], SAID_PROGRAM_ID);

console.log(`📦 Treasury PDA: ${treasuryPda.toBase58()}`);

const balance = await connection.getBalance(treasuryPda);
console.log(`💰 Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

const withdrawAmount = Math.floor(parseFloat(amountArg) * LAMPORTS_PER_SOL);
console.log(`📤 Withdrawing: ${(withdrawAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

const data = Buffer.alloc(16);
discriminator.copy(data, 0);
data.writeBigUInt64LE(BigInt(withdrawAmount), 8);

const ix = new TransactionInstruction({
  programId: SAID_PROGRAM_ID,
  keys: [
    { pubkey: treasuryPda, isSigner: false, isWritable: true },
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const tx = new Transaction().add(ix);
tx.feePayer = authority.publicKey;
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
tx.sign(authority);

console.log('📡 Sending...');
const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
console.log(`📝 Sig: ${sig}`);

await connection.confirmTransaction(sig, 'confirmed');

const newBal = await connection.getBalance(treasuryPda);
const authBal = await connection.getBalance(authority.publicKey);
console.log(`✅ Done! Treasury: ${(newBal / LAMPORTS_PER_SOL).toFixed(4)} SOL | Authority: ${(authBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
