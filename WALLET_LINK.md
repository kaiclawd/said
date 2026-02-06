# Wallet Link: Multi-Wallet Identity for SAID Protocol

## What Changed

Added three instructions and one PDA to support multiple wallets per identity.

**The problem:** One wallet = one identity. Lose the wallet, lose your reputation, verification, everything. No recovery, no key rotation, no multi-wallet agents.

**The solution:** `WalletLink` -- a reverse-pointer PDA that maps any wallet back to an identity. One person, many credit cards.

### New State

```rust
// Added to AgentIdentity:
pub authority: Pubkey,  // current admin (initially = owner, transferable)

// New account:
pub struct WalletLink {
    pub agent_id: Pubkey,   // points back to AgentIdentity PDA
    pub wallet: Pubkey,     // the linked wallet
    pub bump: u8,
}
// PDA seeds: [b"wallet", linked_wallet.key()]
```

### New Instructions

| Instruction | Signers | What it does |
|---|---|---|
| `link_wallet` | authority + new wallet | Links a wallet to the identity. Both must sign (proves control of both). |
| `unlink_wallet` | authority OR linked wallet | Removes a wallet link. Authority can remove any, wallet can remove itself. |
| `transfer_authority` | linked wallet | Linked wallet becomes the new authority. Recovery mechanism. |

### Modified Instructions

- `register_agent` -- now sets `authority = owner` on creation
- `get_verified` -- checks `authority` instead of `owner`
- `update_agent` -- checks `authority` instead of `owner`

### Wallet Resolution (Client-Side)

```typescript
// Given any wallet, find the identity:

// 1. Is this a primary owner?
const [agentPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("agent"), wallet.toBuffer()],
  programId
);
let identity = await program.account.agentIdentity.fetchNullable(agentPda);

// 2. If not, is this a linked wallet?
if (!identity) {
  const [linkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("wallet"), wallet.toBuffer()],
    programId
  );
  const link = await program.account.walletLink.fetchNullable(linkPda);
  if (link) {
    identity = await program.account.agentIdentity.fetch(link.agentId);
  }
}
```

### Recovery Scenario

```
1. Alice registers with wallet A (owner=A, authority=A)
2. Alice links wallet B (both A and B sign)
3. Alice loses wallet A
4. Alice calls transfer_authority from wallet B → authority becomes B
5. Alice can now update metadata, link new wallets, verify -- all from wallet B
6. The identity PDA address never changes. Only the admin rotates.
```

---

## Setup & Tooling

### Prerequisites

- **Rust**: 1.79+ (tested on 1.92.0)
- **Solana CLI**: 1.18+ (`solana --version`)
- **Anchor CLI**: 0.32.1 (`anchor --version`)
- **Node.js**: 18+ (`node --version`)

### Anchor Version

This fork upgrades `anchor-lang` from `0.30.1` to `0.32.1`. If your Anchor CLI is older:

```bash
# Check your version
anchor --version

# Install 0.32.1 if needed
cargo install --git https://github.com/coral-xyz/anchor --tag v0.32.1 anchor-cli
```

If you need to stay on 0.30.1 for other reasons, you can downgrade:

```toml
# programs/said/Cargo.toml
anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
```

Then remove the `idl-build` feature line and change the test script in `Anchor.toml` back to `yarn`. Note: on 0.30.1 you may need to rename the `caller` field in `UnlinkWallet` back to avoid codegen issues with `Signer` types.

### blake3 Compatibility

If you hit this error during `anchor build`:

```
feature `edition2024` is required
```

Pin blake3 to a compatible version:

```bash
cargo update -p blake3 --precise 1.8.2
```

This happens when the Solana BPF toolchain (Cargo 1.84) can't handle the latest blake3 crate.

---

## Building

```bash
# Build the program
anchor build

# The build will generate:
# - target/deploy/said.so        (program binary)
# - target/idl/said.json          (IDL)
# - target/types/said.ts          (TypeScript types)
```

---

## Running Tests

```bash
# Install test dependencies (first time only)
npm install

# Run all 26 tests
anchor test
```

This starts a local validator, deploys the program, and runs the test suite.

### Test Suite

| Suite | Tests | Coverage |
|---|---|---|
| register_agent | 2 | Register identity, prevent duplicate registration |
| update_agent | 2 | Authority updates metadata, non-authority blocked |
| link_wallet | 5 | Dual signatures, non-authority blocked, no double-link, multi-wallet resolution |
| transfer_authority | 5 | Linked wallet takes over, new authority works, old authority blocked, non-linked blocked, chain transfers |
| unlink_wallet | 3 | Authority removes wallet, unauthorized blocked, self-removal |
| recovery scenario | 4 | Register → link backup → lose primary → recover → update → link new |
| submit_feedback | 2 | Positive/negative feedback, reputation score calculation |
| validate_work | 2 | Task validation, prevent duplicate attestation |

### If Tests Fail

**"solana-test-validator: command not found"**
```bash
# Install Solana CLI tools
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

**"Account already in use" on first run**
The local validator has stale state. Clean and retry:
```bash
anchor test --skip-build
```

**Airdrop failures**
The test airdrops 10 SOL to each test wallet on localnet. If the validator is rate-limiting:
```bash
# Restart with a fresh validator
solana-test-validator --reset &
anchor test --skip-local-validator
```

---

## Breaking Changes

This is a **breaking change** for existing deployed identities because `AgentIdentity` now has an `authority` field that didn't exist before. Existing accounts won't have this field populated.

**Options for migration:**
1. **Redeploy fresh** -- simplest, no migration needed
2. **Migration instruction** -- add a one-time `migrate_identity` instruction that sets `authority = owner` for existing accounts
3. **Account reallocation** -- use `realloc` to expand existing accounts and backfill the authority field

For a protocol that hasn't launched on mainnet yet, option 1 is the move.

---

## Security Properties

- **Dual signature on link**: Both authority AND new wallet must sign. You can't claim someone else's wallet.
- **Transfer only to linked wallets**: Attacker would need to compromise TWO wallets (the authority + a linked wallet) to steal an identity.
- **Self-unlink**: Any linked wallet can remove itself. You can always "cancel your own credit card."
- **Authority ≠ Owner**: The PDA address is permanent (derived from original owner). Authority is just the admin key -- it rotates, the identity doesn't move.
