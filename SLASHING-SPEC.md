# SAID Protocol: Slashing Mechanism Spec

**Version:** 0.1 (Draft)
**Date:** 2026-04-10
**Status:** Design Phase

---

## Problem Statement

Two critical attacks threaten agent identity systems:

1. **Old Wallet Attack**: Bad actors buy wallets with established reputation to use maliciously
2. **Lost Key Problem**: Legitimate agents lose identity forever if keys are lost

Current SAID infrastructure handles recovery via `transfer_authority` to linked wallets. This spec addresses the slashing mechanism to prevent reputation hijacking.

---

## Design Goals

1. **Minimal Program Changes**: Build on existing `AgentIdentity` and `AgentReputation` accounts
2. **Economic Security**: Make malicious use unprofitable
3. **Decentralized Resolution**: Don't rely on centralized admin for slashing decisions
4. **Composable**: Let other protocols read stake/slash status

---

## Integration with Existing Infrastructure

### Current SAID Program State

```rust
// Existing accounts (from lib.rs)
AgentIdentity {
    owner: Pubkey,           // permanent - PDA seed
    authority: Pubkey,       // current admin - transferable
    metadata_uri: String,
    created_at: i64,
    is_verified: bool,       // ✅ This becomes gated by stake
    verified_at: Option<i64>,
    bump: u8,
}

AgentReputation {
    agent_id: Pubkey,
    total_interactions: u64,
    positive_feedback: u64,
    negative_feedback: u64,
    reputation_score: u16,   // 0-10000 basis points
    last_updated: i64,       // ✅ Can use for decay
    bump: u8,
}

// Existing capabilities
- transfer_authority()      // ✅ Recovery mechanism exists
- link_wallet()             // ✅ Multi-wallet support exists  
- submit_feedback()         // ✅ Reputation system exists
```

### New Accounts Required

```rust
/// Stake account holding agent's security deposit
#[account]
#[derive(InitSpace)]
pub struct AgentStake {
    pub agent_id: Pubkey,           // Links to AgentIdentity
    pub amount: u64,                // Staked lamports
    pub staked_at: i64,             // When stake was deposited
    pub last_verification: i64,     // For decay mechanism
    pub is_slashed: bool,           // If true, cannot re-verify
    pub slash_reason: Option<SlashReason>,
    pub bump: u8,
}

/// Slash proposal (for decentralized resolution)
#[account]
#[derive(InitSpace)]
pub struct SlashProposal {
    pub agent_id: Pubkey,           // Target agent
    pub proposer: Pubkey,           // Who submitted the report
    pub evidence_uri: String,       // IPFS/Arweave link to evidence
    pub created_at: i64,
    pub votes_for: u64,             // Weighted by reputation
    pub votes_against: u64,
    pub resolved: bool,
    pub outcome: Option<bool>,      // true = slashed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub enum SlashReason {
    WalletSale,         // Detected transfer of control to bad actor
    MaliciousActivity,  // Scam, rug, fraud
    FakeIdentity,       // Impersonation
    SpamAbuse,          // Reputation gaming
}
```

---

## New Instructions

### 1. `stake_for_verification`

Upgrades a registered agent to verified status by depositing stake.

```rust
pub fn stake_for_verification(ctx: Context<StakeForVerification>) -> Result<()> {
    const STAKE_AMOUNT: u64 = 100_000_000; // 0.1 SOL
    
    // Transfer stake to escrow PDA
    system_program::transfer(
        CpiContext::new(...),
        STAKE_AMOUNT,
    )?;
    
    // Create stake account
    let stake = &mut ctx.accounts.agent_stake;
    stake.agent_id = ctx.accounts.agent_identity.key();
    stake.amount = STAKE_AMOUNT;
    stake.staked_at = Clock::get()?.unix_timestamp;
    stake.last_verification = Clock::get()?.unix_timestamp;
    stake.is_slashed = false;
    
    // Mark as verified (existing behavior)
    let agent = &mut ctx.accounts.agent_identity;
    agent.is_verified = true;
    agent.verified_at = Some(Clock::get()?.unix_timestamp);
    
    Ok(())
}
```

**Migration Path:**
- Existing verified agents (2,715) get grandfathered with `is_verified = true`
- New stake requirement only for NEW verifications post-launch
- Optional: incentivize existing agents to stake with reputation boost

### 2. `renew_verification`

Prevents reputation decay by proving continued active operation.

```rust
pub fn renew_verification(ctx: Context<RenewVerification>) -> Result<()> {
    const RENEWAL_PERIOD: i64 = 90 * 24 * 60 * 60; // 90 days
    
    let stake = &mut ctx.accounts.agent_stake;
    let now = Clock::get()?.unix_timestamp;
    
    // Must renew before expiry
    require!(
        now - stake.last_verification <= RENEWAL_PERIOD,
        SaidError::VerificationExpired
    );
    
    stake.last_verification = now;
    
    emit!(VerificationRenewed {
        agent_id: stake.agent_id,
        renewed_at: now,
        next_deadline: now + RENEWAL_PERIOD,
    });
    
    Ok(())
}
```

### 3. `propose_slash`

Anyone can propose slashing an agent with evidence.

```rust
pub fn propose_slash(
    ctx: Context<ProposeSlash>,
    evidence_uri: String,
    reason: SlashReason,
) -> Result<()> {
    const PROPOSAL_BOND: u64 = 10_000_000; // 0.01 SOL (lost if proposal fails)
    
    // Proposer must bond SOL (prevents spam)
    system_program::transfer(..., PROPOSAL_BOND)?;
    
    let proposal = &mut ctx.accounts.slash_proposal;
    proposal.agent_id = ctx.accounts.agent_identity.key();
    proposal.proposer = ctx.accounts.proposer.key();
    proposal.evidence_uri = evidence_uri;
    proposal.created_at = Clock::get()?.unix_timestamp;
    proposal.votes_for = 0;
    proposal.votes_against = 0;
    proposal.resolved = false;
    
    emit!(SlashProposed { ... });
    
    Ok(())
}
```

### 4. `vote_on_slash`

Verified agents vote on slash proposals (weighted by reputation).

```rust
pub fn vote_on_slash(
    ctx: Context<VoteOnSlash>,
    support: bool,
) -> Result<()> {
    // Only verified agents can vote
    require!(
        ctx.accounts.voter_identity.is_verified,
        SaidError::VoterNotVerified
    );
    
    // Weight by reputation score
    let weight = ctx.accounts.voter_reputation.reputation_score as u64;
    
    let proposal = &mut ctx.accounts.slash_proposal;
    if support {
        proposal.votes_for += weight;
    } else {
        proposal.votes_against += weight;
    }
    
    Ok(())
}
```

### 5. `execute_slash`

Finalizes slash after voting period.

```rust
pub fn execute_slash(ctx: Context<ExecuteSlash>) -> Result<()> {
    const VOTING_PERIOD: i64 = 7 * 24 * 60 * 60; // 7 days
    const QUORUM: u64 = 10000; // Minimum total vote weight
    const THRESHOLD: u64 = 6000; // 60% majority needed
    
    let proposal = &ctx.accounts.slash_proposal;
    let now = Clock::get()?.unix_timestamp;
    
    // Voting period must be over
    require!(
        now - proposal.created_at >= VOTING_PERIOD,
        SaidError::VotingNotComplete
    );
    
    // Must meet quorum
    let total_votes = proposal.votes_for + proposal.votes_against;
    require!(total_votes >= QUORUM, SaidError::QuorumNotMet);
    
    // Check if slash passes
    let slash_passes = (proposal.votes_for * 10000 / total_votes) >= THRESHOLD;
    
    if slash_passes {
        // Execute slash
        let stake = &mut ctx.accounts.agent_stake;
        stake.is_slashed = true;
        stake.slash_reason = Some(proposal.reason.clone());
        
        // Revoke verification
        let agent = &mut ctx.accounts.agent_identity;
        agent.is_verified = false;
        
        // Distribute slashed funds
        // 50% to treasury, 50% to proposer
        let slash_amount = stake.amount;
        // ... transfer logic
        
        emit!(AgentSlashed { ... });
    } else {
        // Slash rejected - return proposer's bond to agent
        // ... transfer logic
        
        emit!(SlashRejected { ... });
    }
    
    Ok(())
}
```

### 6. `unstake`

Withdraw stake (only if not slashed and verification not needed).

```rust
pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
    let stake = &ctx.accounts.agent_stake;
    
    // Cannot unstake if slashed
    require!(!stake.is_slashed, SaidError::AgentSlashed);
    
    // Unstaking revokes verification
    let agent = &mut ctx.accounts.agent_identity;
    agent.is_verified = false;
    
    // Return stake
    // ... transfer logic
    
    emit!(AgentUnstaked { ... });
    
    Ok(())
}
```

---

## Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Stake Amount | 0.1 SOL | ~$20 — meaningful but accessible |
| Renewal Period | 90 days | Quarterly re-verification |
| Voting Period | 7 days | Time for community review |
| Quorum | 10,000 weight | ~100 average-rep voters |
| Slash Threshold | 60% | Supermajority needed |
| Proposer Bond | 0.01 SOL | Spam prevention |
| Slash Distribution | 50/50 | Treasury + Proposer incentive |

---

## Migration Strategy

### Phase 1: Soft Launch (Week 1-2)
- Deploy new instructions
- Stake optional for new verifications
- Existing 2,715 verified agents remain verified
- No slashing active yet

### Phase 2: Incentive Period (Week 3-4)
- Staked agents get "SAID+" badge
- Reputation boost for staked agents
- Dashboard shows stake status
- Encourage voluntary staking

### Phase 3: Requirement (Week 5+)
- New verifications REQUIRE stake
- Existing verified agents have 90 days to stake
- Slashing voting goes live
- Non-staked agents marked as "legacy verified"

---

## Security Considerations

### Attack: Sybil Voting
**Risk:** Create many agents to control slash votes
**Mitigation:** Weight by reputation score, require stake to vote

### Attack: Malicious Slash Proposals
**Risk:** Spam proposals to harass legitimate agents
**Mitigation:** Proposer bond lost if slash fails

### Attack: Stake Evasion
**Risk:** Withdraw stake before slash executes
**Mitigation:** Stake locked during active proposal

### Attack: Reputation Farming
**Risk:** Bots inflate reputation before bad action
**Mitigation:** Reputation decay + time-weighted scoring

---

## API Additions

```typescript
// Check if agent is stakable
GET /agents/:id/stake-status
{
  "staked": true,
  "amount": 100000000,
  "lastRenewal": "2026-04-10T12:00:00Z",
  "nextDeadline": "2026-07-09T12:00:00Z",
  "slashed": false,
  "activeProposals": 0
}

// Submit slash proposal
POST /agents/:id/slash-proposal
{
  "evidenceUri": "ipfs://...",
  "reason": "malicious_activity"
}

// Vote on proposal
POST /slash-proposals/:id/vote
{
  "support": true
}
```

---

## Open Questions

1. **Stake amount**: 0.1 SOL enough? Too much for indie devs?
2. **Voting mechanism**: Pure reputation weight, or 1-agent-1-vote?
3. **Emergency slash**: Should treasury authority have override power?
4. **Delegation**: Can agents delegate voting power?
5. **Appeals**: How to handle wrongful slashes?

---

## Next Steps

1. [ ] Review spec with team
2. [ ] Get feedback from SeekerClaw / FairScale
3. [ ] Finalize parameters
4. [ ] Implement `stake_for_verification` (smallest change)
5. [ ] Build voting UI
6. [ ] Audit before mainnet

---

## Why This Matters for Pump Fund

> "Old wallets" attack = reputation is meaningless
> 
> With slashing:
> - Selling a trusted identity = selling staked collateral
> - Buyer risks losing stake on first bad action
> - **Economic security makes reputation valuable**
>
> This is what separates SAID from any identity registry.
> We're not just verifying — we're securing.
