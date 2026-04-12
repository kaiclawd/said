import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("ESPreFucjVwtDmZbhtL3JLJ9VxCethNEYtosMQhkcurv");
const TREASURY = new PublicKey("Gnm9rzSWmzcSi6Pw59qHvpPE4PZNyqRpQYXGBzYgvNqq");

describe("said stake test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("registers and stakes an agent", async () => {
    const wallet = provider.wallet;
    
    const [agentIdentity] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), wallet.publicKey.toBuffer()],
      PROGRAM_ID
    );
    const [agentStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), agentIdentity.toBuffer()],
      PROGRAM_ID
    );
    
    console.log("Wallet:", wallet.publicKey.toBase58());
    console.log("Agent PDA:", agentIdentity.toBase58());
    console.log("Stake PDA:", agentStake.toBase58());
    
    const stakeAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    
    // Use raw instruction since we have minimal IDL
    const ix = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: agentIdentity, isSigner: false, isWritable: true },
        { pubkey: agentStake, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: TREASURY, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        // register_and_stake discriminator (first 8 bytes of sha256("global:register_and_stake"))
        Buffer.from([0x67, 0xcd, 0xf0, 0x34, 0xc0, 0x55, 0xf3, 0x95]),
        // name length + name ("TestAgent" = 9 chars)
        Buffer.from([9, 0, 0, 0]),
        Buffer.from("TestAgent"),
        // stake_amount (0.1 SOL = 100_000_000 lamports, little endian u64)
        Buffer.from([0x00, 0xe1, 0xf5, 0x05, 0x00, 0x00, 0x00, 0x00]),
      ]),
    });
    
    const tx = new anchor.web3.Transaction().add(ix);
    const sig = await provider.sendAndConfirm(tx);
    
    console.log("Success! Tx:", sig);
    console.log("Explorer: https://solscan.io/tx/" + sig + "?cluster=devnet");
  });
});
