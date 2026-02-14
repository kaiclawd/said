import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Said } from "../target/types/said";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import crypto from "crypto";

describe("said", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Said as Program<Said>;

  // Wallets
  const owner = Keypair.generate();
  const walletB = Keypair.generate();
  const walletC = Keypair.generate();
  const walletD = Keypair.generate();
  const randomWallet = Keypair.generate();

  // PDA helpers
  function agentPda(wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), wallet.toBuffer()],
      program.programId
    );
  }

  function walletLinkPda(wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("wallet"), wallet.toBuffer()],
      program.programId
    );
  }

  function reputationPda(agentId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agentId.toBuffer()],
      program.programId
    );
  }

  function validationPda(agentId: PublicKey, taskHash: Buffer): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("validation"), agentId.toBuffer(), taskHash],
      program.programId
    );
  }

  before(async () => {
    // Airdrop to all test wallets
    const airdrops = [owner, walletB, walletC, walletD, randomWallet].map(async (kp) => {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    });
    await Promise.all(airdrops);
  });

  // ==================== REGISTRATION ====================

  describe("register_agent", () => {
    it("registers a new agent identity", async () => {
      const [pda] = agentPda(owner.publicKey);

      await program.methods
        .registerAgent("https://example.com/agent.json")
        .accounts({
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      const account = await program.account.agentIdentity.fetch(pda);
      expect(account.owner.toBase58()).to.equal(owner.publicKey.toBase58());
      expect(account.authority.toBase58()).to.equal(owner.publicKey.toBase58());
      expect(account.metadataUri).to.equal("https://example.com/agent.json");
      expect(account.isVerified).to.be.false;
      expect(account.verifiedAt).to.be.null;
    });

    it("cannot register twice with same wallet", async () => {
      try {
        await program.methods
          .registerAgent("https://duplicate.com")
          .accounts({
            owner: owner.publicKey,
          })
          .signers([owner])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        // PDA already exists
        expect(e.toString()).to.contain("already in use");
      }
    });
  });

  // ==================== UPDATE AGENT ====================

  describe("update_agent", () => {
    it("authority can update metadata", async () => {
      const [pda] = agentPda(owner.publicKey);

      await program.methods
        .updateAgent("https://example.com/updated.json")
        .accounts({
          agentIdentity: pda,
          authority: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      const account = await program.account.agentIdentity.fetch(pda);
      expect(account.metadataUri).to.equal("https://example.com/updated.json");
    });

    it("non-authority cannot update metadata", async () => {
      const [pda] = agentPda(owner.publicKey);

      try {
        await program.methods
          .updateAgent("https://hacker.com/evil.json")
          .accounts({
            agentIdentity: pda,
            authority: randomWallet.publicKey,
          })
          .signers([randomWallet])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.toString()).to.contain("Unauthorized");
      }
    });
  });

  // ==================== WALLET LINKING ====================

  describe("link_wallet", () => {
    it("authority links wallet B with dual signatures", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [linkPda] = walletLinkPda(walletB.publicKey);

      await program.methods
        .linkWallet()
        .accounts({
          agentIdentity: identityPda,
          authority: owner.publicKey,
          newWallet: walletB.publicKey,
        })
        .signers([owner, walletB])
        .rpc();

      const link = await program.account.walletLink.fetch(linkPda);
      expect(link.agentId.toBase58()).to.equal(identityPda.toBase58());
      expect(link.wallet.toBase58()).to.equal(walletB.publicKey.toBase58());
    });

    it("authority links wallet C", async () => {
      const [identityPda] = agentPda(owner.publicKey);

      await program.methods
        .linkWallet()
        .accounts({
          agentIdentity: identityPda,
          authority: owner.publicKey,
          newWallet: walletC.publicKey,
        })
        .signers([owner, walletC])
        .rpc();

      const [linkPda] = walletLinkPda(walletC.publicKey);
      const link = await program.account.walletLink.fetch(linkPda);
      expect(link.wallet.toBase58()).to.equal(walletC.publicKey.toBase58());
    });

    it("cannot link without new wallet signature", async () => {
      const [identityPda] = agentPda(owner.publicKey);

      try {
        await program.methods
          .linkWallet()
          .accounts({
            agentIdentity: identityPda,
            authority: owner.publicKey,
            newWallet: walletD.publicKey,
          })
          .signers([owner]) // missing walletD signature
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.toString()).to.contain("Signature verification failed");
      }
    });

    it("non-authority cannot link wallets", async () => {
      const [identityPda] = agentPda(owner.publicKey);

      try {
        await program.methods
          .linkWallet()
          .accounts({
            agentIdentity: identityPda,
            authority: randomWallet.publicKey,
            newWallet: walletD.publicKey,
          })
          .signers([randomWallet, walletD])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.toString()).to.contain("Unauthorized");
      }
    });

    it("cannot link a wallet that is already linked", async () => {
      const [identityPda] = agentPda(owner.publicKey);

      try {
        await program.methods
          .linkWallet()
          .accounts({
            agentIdentity: identityPda,
            authority: owner.publicKey,
            newWallet: walletB.publicKey,
          })
          .signers([owner, walletB])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        // PDA already exists
        expect(e.toString()).to.contain("already in use");
      }
    });

    it("all linked wallets resolve to same identity", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [linkB] = walletLinkPda(walletB.publicKey);
      const [linkC] = walletLinkPda(walletC.publicKey);

      const walletLinkB = await program.account.walletLink.fetch(linkB);
      const walletLinkC = await program.account.walletLink.fetch(linkC);

      expect(walletLinkB.agentId.toBase58()).to.equal(identityPda.toBase58());
      expect(walletLinkC.agentId.toBase58()).to.equal(identityPda.toBase58());
    });
  });

  // ==================== TRANSFER AUTHORITY ====================

  describe("transfer_authority", () => {
    it("linked wallet B takes over as authority", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [linkPda] = walletLinkPda(walletB.publicKey);

      await program.methods
        .transferAuthority()
        .accounts({
          agentIdentity: identityPda,
          walletLink: linkPda,
          newAuthority: walletB.publicKey,
        })
        .signers([walletB])
        .rpc();

      const account = await program.account.agentIdentity.fetch(identityPda);
      expect(account.authority.toBase58()).to.equal(walletB.publicKey.toBase58());
      // owner stays the same (permanent PDA seed)
      expect(account.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    });

    it("new authority (wallet B) can update metadata", async () => {
      const [identityPda] = agentPda(owner.publicKey);

      await program.methods
        .updateAgent("https://example.com/wallet-b-update.json")
        .accounts({
          agentIdentity: identityPda,
          authority: walletB.publicKey,
        })
        .signers([walletB])
        .rpc();

      const account = await program.account.agentIdentity.fetch(identityPda);
      expect(account.metadataUri).to.equal("https://example.com/wallet-b-update.json");
    });

    it("old authority (owner) can no longer update", async () => {
      const [identityPda] = agentPda(owner.publicKey);

      try {
        await program.methods
          .updateAgent("https://example.com/old-owner-attempt.json")
          .accounts({
            agentIdentity: identityPda,
            authority: owner.publicKey,
          })
          .signers([owner])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.toString()).to.contain("Unauthorized");
      }
    });

    it("non-linked wallet cannot transfer authority", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [fakeLinkPda] = walletLinkPda(randomWallet.publicKey);

      try {
        await program.methods
          .transferAuthority()
          .accounts({
            agentIdentity: identityPda,
            walletLink: fakeLinkPda,
            newAuthority: randomWallet.publicKey,
          })
          .signers([randomWallet])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        // WalletLink PDA doesn't exist
        expect(e.toString()).to.match(/AccountNotInitialized|does not exist/);
      }
    });

    it("transfer authority back to wallet C", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [linkPda] = walletLinkPda(walletC.publicKey);

      await program.methods
        .transferAuthority()
        .accounts({
          agentIdentity: identityPda,
          walletLink: linkPda,
          newAuthority: walletC.publicKey,
        })
        .signers([walletC])
        .rpc();

      const account = await program.account.agentIdentity.fetch(identityPda);
      expect(account.authority.toBase58()).to.equal(walletC.publicKey.toBase58());
    });
  });

  // ==================== UNLINK WALLET ====================

  describe("unlink_wallet", () => {
    it("authority (wallet C) unlinks wallet B", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [linkPda] = walletLinkPda(walletB.publicKey);

      await program.methods
        .unlinkWallet()
        .accounts({
          agentIdentity: identityPda,
          walletLink: linkPda,
          caller: walletC.publicKey, // current authority
        })
        .signers([walletC])
        .rpc();

      // WalletLink PDA should be closed
      const link = await provider.connection.getAccountInfo(linkPda);
      expect(link).to.be.null;
    });

    it("random wallet cannot unlink", async () => {
      // First re-link wallet B for further testing
      const [identityPda] = agentPda(owner.publicKey);

      await program.methods
        .linkWallet()
        .accounts({
          agentIdentity: identityPda,
          authority: walletC.publicKey, // current authority
          newWallet: walletB.publicKey,
        })
        .signers([walletC, walletB])
        .rpc();

      const [linkPda] = walletLinkPda(walletB.publicKey);

      try {
        await program.methods
          .unlinkWallet()
          .accounts({
            agentIdentity: identityPda,
            walletLink: linkPda,
            caller: randomWallet.publicKey,
          })
          .signers([randomWallet])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.toString()).to.contain("Unauthorized");
      }
    });

    it("linked wallet can unlink itself", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [linkPda] = walletLinkPda(walletB.publicKey);

      await program.methods
        .unlinkWallet()
        .accounts({
          agentIdentity: identityPda,
          walletLink: linkPda,
          caller: walletB.publicKey, // wallet removes itself
        })
        .signers([walletB])
        .rpc();

      const link = await provider.connection.getAccountInfo(linkPda);
      expect(link).to.be.null;
    });
  });

  // ==================== RECOVERY SCENARIO ====================

  describe("recovery: primary owner loses wallet", () => {
    // Simulates: owner registers, links walletD, then "loses" owner wallet.
    // walletD recovers by transferring authority to itself.

    const recoveryOwner = Keypair.generate();
    const recoveryBackup = Keypair.generate();

    before(async () => {
      const airdrops = [recoveryOwner, recoveryBackup].map(async (kp) => {
        const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(sig);
      });
      await Promise.all(airdrops);
    });

    it("register and link backup wallet", async () => {
      const [identityPda] = agentPda(recoveryOwner.publicKey);

      await program.methods
        .registerAgent("https://example.com/recovery-agent.json")
        .accounts({
          owner: recoveryOwner.publicKey,
        })
        .signers([recoveryOwner])
        .rpc();

      await program.methods
        .linkWallet()
        .accounts({
          agentIdentity: identityPda,
          authority: recoveryOwner.publicKey,
          newWallet: recoveryBackup.publicKey,
        })
        .signers([recoveryOwner, recoveryBackup])
        .rpc();
    });

    it("backup wallet recovers authority after primary is lost", async () => {
      const [identityPda] = agentPda(recoveryOwner.publicKey);
      const [linkPda] = walletLinkPda(recoveryBackup.publicKey);

      // "Primary wallet is lost" -- we just don't use recoveryOwner anymore
      await program.methods
        .transferAuthority()
        .accounts({
          agentIdentity: identityPda,
          walletLink: linkPda,
          newAuthority: recoveryBackup.publicKey,
        })
        .signers([recoveryBackup])
        .rpc();

      const account = await program.account.agentIdentity.fetch(identityPda);
      expect(account.authority.toBase58()).to.equal(recoveryBackup.publicKey.toBase58());
    });

    it("recovered authority can update metadata", async () => {
      const [identityPda] = agentPda(recoveryOwner.publicKey);

      await program.methods
        .updateAgent("https://example.com/recovered.json")
        .accounts({
          agentIdentity: identityPda,
          authority: recoveryBackup.publicKey,
        })
        .signers([recoveryBackup])
        .rpc();

      const account = await program.account.agentIdentity.fetch(identityPda);
      expect(account.metadataUri).to.equal("https://example.com/recovered.json");
    });

    it("recovered authority can link new wallets", async () => {
      const [identityPda] = agentPda(recoveryOwner.publicKey);
      const newWallet = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(newWallet.publicKey, LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      await program.methods
        .linkWallet()
        .accounts({
          agentIdentity: identityPda,
          authority: recoveryBackup.publicKey,
          newWallet: newWallet.publicKey,
        })
        .signers([recoveryBackup, newWallet])
        .rpc();

      const [linkPda] = walletLinkPda(newWallet.publicKey);
      const link = await program.account.walletLink.fetch(linkPda);
      expect(link.agentId.toBase58()).to.equal(identityPda.toBase58());
    });
  });

  // ==================== FEEDBACK & REPUTATION ====================

  describe("submit_feedback", () => {
    it("submits positive feedback", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [repPda] = reputationPda(identityPda);

      await program.methods
        .submitFeedback(true, "good trade on torch.market")
        .accounts({
          agentIdentity: identityPda,
          reviewer: randomWallet.publicKey,
        })
        .signers([randomWallet])
        .rpc();

      const rep = await program.account.agentReputation.fetch(repPda);
      expect(rep.totalInteractions.toNumber()).to.equal(1);
      expect(rep.positiveFeedback.toNumber()).to.equal(1);
      expect(rep.negativeFeedback.toNumber()).to.equal(0);
      expect(rep.reputationScore).to.equal(10000); // 100%
    });

    it("submits negative feedback, score updates", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const [repPda] = reputationPda(identityPda);

      await program.methods
        .submitFeedback(false, "failed to deliver")
        .accounts({
          agentIdentity: identityPda,
          reviewer: walletD.publicKey,
        })
        .signers([walletD])
        .rpc();

      const rep = await program.account.agentReputation.fetch(repPda);
      expect(rep.totalInteractions.toNumber()).to.equal(2);
      expect(rep.positiveFeedback.toNumber()).to.equal(1);
      expect(rep.negativeFeedback.toNumber()).to.equal(1);
      expect(rep.reputationScore).to.equal(5000); // 50%
    });
  });

  // ==================== WORK VALIDATION ====================

  describe("validate_work", () => {
    it("validates agent work with task hash", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const taskHash = crypto.createHash("sha256").update("task-001").digest();
      const [valPda] = validationPda(identityPda, taskHash);

      await program.methods
        .validateWork([...taskHash] as any, true, "https://example.com/evidence")
        .accounts({
          agentIdentity: identityPda,
          validator: randomWallet.publicKey,
        })
        .signers([randomWallet])
        .rpc();

      const record = await program.account.validationRecord.fetch(valPda);
      expect(record.agentId.toBase58()).to.equal(identityPda.toBase58());
      expect(record.validator.toBase58()).to.equal(randomWallet.publicKey.toBase58());
      expect(record.passed).to.be.true;
      expect(record.evidenceUri).to.equal("https://example.com/evidence");
    });

    it("cannot validate same task twice", async () => {
      const [identityPda] = agentPda(owner.publicKey);
      const taskHash = crypto.createHash("sha256").update("task-001").digest();

      try {
        await program.methods
          .validateWork([...taskHash] as any, false, "https://example.com/evidence2")
          .accounts({
            agentIdentity: identityPda,
            validator: walletD.publicKey,
          })
          .signers([walletD])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.toString()).to.contain("already in use");
      }
    });
  });
});
