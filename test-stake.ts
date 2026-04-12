import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("ESPreFucjVwtDmZbhtL3JLJ9VxCethNEYtosMQhkcurv");
const RPC = "https://api.devnet.solana.com";

// Minimal IDL
const IDL: anchor.Idl = {
  version: "0.1.0",
  name: "said",
  instructions: [
    {
      name: "registerAndStake",
      accounts: [
        { name: "agentIdentity", isMut: true, isSigner: false },
        { name: "agentStake", isMut: true, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "treasury", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "name", type: "string" },
        { name: "stakeAmount", type: "u64" },
      ],
    },
  ],
};

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
  
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(wallet), { commitment: "confirmed" });
  const program = new anchor.Program(IDL, PROGRAM_ID, provider);
  
  // PDAs
  const [agentIdentity] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), wallet.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [agentStake] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), agentIdentity.toBuffer()],
    PROGRAM_ID
  );
  const treasury = new PublicKey("Gnm9rzSWmzcSi6Pw59qHvpPE4PZNyqRpQYXGBzYgvNqq");
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Agent PDA:", agentIdentity.toBase58());
  console.log("Stake PDA:", agentStake.toBase58());
  
  const stakeAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
  
  try {
    const sig = await program.methods
      .registerAndStake("TestAgent", stakeAmount)
      .accounts({
        agentIdentity,
        agentStake,
        authority: wallet.publicKey,
        treasury,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc();
    
    console.log("Success! Tx:", sig);
    console.log("Explorer: https://solscan.io/tx/" + sig + "?cluster=devnet");
  } catch (e: any) {
    console.error("Error:", e.message || e);
    if (e.logs) console.log("Logs:", e.logs.join("\n"));
  }
}

main();
