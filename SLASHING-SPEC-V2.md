# SAID Protocol: Trust & Slashing Mechanism V2

**Version:** 2.0 (Post-Stress Test)
**Date:** 2026-04-10
**Status:** Ready for Implementation

---

## Executive Summary

SAID Protocol provides a layered trust stack for AI agents on Solana: verification, staking, and reputation. This spec defines the economic security mechanism (slashing) that makes the "old wallet attack" unprofitable.

**Key insight from stress-testing:** Community-driven voting on subjective offenses is vulnerable to Sybil attacks, bribery, and plutocracy. V1 uses admin-initiated slashing with appeals, with a roadmap to decentralized governance in V2.

---

## Trust Stack Architecture

```
TRUST SCORE (0-100)
├── Verification Tier (10-25 pts) — logarithmic by tier
├── Stake Amount (0-25 pts) — logarithmic scale
└── Reputation (0-50 pts) — SAID + FairScale, decays over time
```

### Verification Tiers

| Tier | Cost | Refundable? | Slashable? | Trust Points |
|------|------|-------------|------------|--------------|
| Registered | Free | N/A | No | 0 |
| Verified | 0.01 SOL | No (fee) | No | 10 |
| Secured | 0.1 SOL | Yes (stake) | Yes | 15 |
| Professional | 1 SOL | Yes (stake) | Yes | 20 |
| Enterprise | 10+ SOL | Yes (stake) | Yes | 25 |

**Notes:**
- Existing 2,715 Verified agents remain unchanged
- Secured+ tiers are optional upgrades
- Trust points from stake are logarithmic: `points = 15 + 2.5 * log10(stake / 0.1)`

### Reputation Scoring

**Sources:**
- SAID on-chain feedback (50% weight, capped)
- FairScale integration (50% weight, capped)

**Decay:**
```
R_t = R_0 * 0.5^(t / 182)  // 6-month half-life in days
```

**Implementation:** Lazy evaluation — calculate on read, store `last_active` timestamp.

**FairScale Fallback:** If FairScale unavailable, SAID-only scoring with 75% cap on reputation component.

---

## Staking Mechanism

### Account Structure

```rust
#[account]
pub struct AgentStake {
    pub agent_id: Pubkey,
    pub amount: u64,              // Lamports staked
    pub staked_at: i64,
    pub last_active: i64,         // For decay calculation
    pub unstake_requested: Option<i64>,  // Cooldown start
    pub is_slashed: bool,
    pub slash_severity: Option<SlashSeverity>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum SlashSeverity {
    Minor,    // 25% slash
    Major,    // 50% slash
    Critical, // 100% slash
}
```

### Unstaking Cooldown

**Critical security feature:** 14-day cooldown prevents escape before slash.

```rust
pub fn request_unstake(ctx: Context<RequestUnstake>) -> Result<()> {
    let stake = &mut ctx.accounts.agent_stake;
    
    // Cannot unstake if active slash proposal exists
    require!(
        !has_active_proposal(stake.agent_id),
        SaidError::ActiveSlashProposal
    );
    
    stake.unstake_requested = Some(Clock::get()?.unix_timestamp);
    
    emit!(UnstakeRequested {
        agent_id: stake.agent_id,
        available_at: stake.unstake_requested.unwrap() + COOLDOWN_PERIOD,
    });
    
    Ok(())
}

pub fn complete_unstake(ctx: Context<CompleteUnstake>) -> Result<()> {
    let stake = &ctx.accounts.agent_stake;
    let now = Clock::get()?.unix_timestamp;
    
    const COOLDOWN_PERIOD: i64 = 14 * 24 * 60 * 60; // 14 days
    
    require!(
        stake.unstake_requested.is_some(),
        SaidError::UnstakeNotRequested
    );
    
    require!(
        now >= stake.unstake_requested.unwrap() + COOLDOWN_PERIOD,
        SaidError::CooldownNotComplete
    );
    
    // Return stake and revoke Secured status
    // ... transfer logic
    
    Ok(())
}
```

---

## Slashing Mechanism (V1 — Admin-Initiated)

### Why Not Community Voting (Yet)

Stress-testing revealed critical vulnerabilities in community-driven slashing:
1. **Sybil voting:** Create 50 agents for 0.5 SOL, control votes
2. **Vote buying:** On-chain votes enable verifiable bribery
3. **Reputation plutocracy:** Early movers dominate governance
4. **Subjective offenses:** "Fraud" can't be cryptographically proven

**V1 approach:** Admin-initiated slashing with mandatory appeals. Decentralize when:
- Automated detection exists (FairScale patterns)
- Agent base is larger and more distributed
- Reputation data is more robust

### Slashable Offenses & Severity

| Severity | Slash % | Offenses |
|----------|---------|----------|
| **Minor** | 25% | Spam, reputation gaming, minor TOS violations |
| **Major** | 50% | Impersonation, coordinated manipulation, deceptive claims |
| **Critical** | 100% | Wallet draining, rug pulls, fraud, malicious code |

### Process Flow

```
1. REPORT
   └── Anyone submits report via API/UI
   └── Includes: agent ID, evidence URI, offense type
   └── No bond required for reports (different from proposals)

2. REVIEW (Admin)
   └── SAID team reviews within 72 hours
   └── If valid → initiate slash proposal
   └── If invalid → dismiss with reason

3. SLASH PROPOSED
   └── Agent notified via on-chain event
   └── Stake locked (cannot unstake)
   └── 14-day appeal window begins
   └── Funds held in escrow

4. APPEAL WINDOW (14 days)
   └── Agent can submit appeal with counter-evidence
   └── Appeal bond: 0.01 SOL (refunded if successful)
   └── Reviewed by separate admin (not original reviewer)

5. RESOLUTION
   └── If no appeal OR appeal rejected:
       └── Slash executed at specified severity
       └── Funds distributed (see below)
       └── Agent verification revoked
       └── Wallet added to blacklist
   
   └── If appeal accepted:
       └── Slash cancelled
       └── Stake unlocked
       └── Appeal bond refunded
       └── Original reporter notified

6. DISTRIBUTION (on slash)
   └── 100% burned (no profit motive)
   └── Alternative: 90% burned, 10% treasury (for operational costs)
```

### Why Burn Instead of Redistribute?

Perplexity's legal analysis:
> "The SEC has argued that staking programs can constitute investment contracts under Howey... Community-driven fund seizure looks a lot like collective punishment without due process."

**Burning eliminates:**
- Proposer collusion incentive
- Securities law concerns (no "profit from efforts of others")
- Unjust enrichment claims

---

## Sybil Resistance

### At Verification (0.01 SOL tier)

**Current:** Fee-only (weak Sybil resistance)

**Enhanced (implement for V1):**
1. **Social verification:** Link Twitter OR GitHub with min 30 followers/stars
2. **FairScale score check:** Minimum 0.3 credibility score
3. **One agent per social account:** Prevents bulk registration

### At Secured+ Tiers

**Additional requirements:**
1. **Unique domain/endpoint:** Must respond to verification ping
2. **Minimum age:** 30 days as Verified before upgrading
3. **Activity threshold:** At least 1 transaction in past 90 days

### At Voting (V2)

When decentralized voting is implemented:
1. **Stake-weighted voting** (not just reputation)
2. **Quadratic scaling:** Diminishing returns per agent
3. **Minimum age:** 30 days to participate
4. **Time-locked votes:** Cannot change in final 24 hours
5. **Maximum weight cap:** No single agent > 5% of total vote

---

## Reputation Decay

### Formula

```typescript
function calculateReputation(agent: Agent): number {
    const now = Date.now();
    const daysSinceActive = (now - agent.lastActive) / (1000 * 60 * 60 * 24);
    const halfLife = 182; // 6 months in days
    
    const decayFactor = Math.pow(0.5, daysSinceActive / halfLife);
    const decayedRep = agent.baseReputation * decayFactor;
    
    return Math.round(decayedRep);
}
```

### Activity That Resets Decay

- Successful transaction signed via SAID
- Receiving positive feedback
- Renewing verification (re-staking)
- Participating in governance (V2)

### Display

```
Agent Profile:
├── Trust Score: 72/100
├── Reputation: 45/50 (decaying)
├── Last Active: 23 days ago
└── Status: ⚠️ Renew within 67 days to maintain score
```

---

## Cross-Chain Architecture

### Principle: Solana is Canonical

```
SOLANA (Home Chain)
├── All identity registration
├── All staking/unstaking
├── All slashing governance
├── All reputation updates
└── Source of truth

OTHER CHAINS (Mirrors)
├── Read-only trust scores
├── Synced via Chainlink CCIP or Wormhole
├── Cannot modify state
└── Updates propagate from Solana
```

### Cross-Chain Offense Handling

If offense occurs on Base:
1. Evidence submitted to Solana
2. Slashing adjudicated on Solana
3. Slash result propagates to Base mirror
4. Agent loses trust status on all chains

### Implementation (V2)

```rust
// On Solana: emit cross-chain message after slash
pub fn propagate_slash(ctx: Context<PropagateSlash>) -> Result<()> {
    let message = CrossChainMessage {
        agent_id: ctx.accounts.agent_stake.agent_id,
        action: Action::Slashed,
        severity: ctx.accounts.agent_stake.slash_severity,
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    // Send via Wormhole/CCIP
    emit_cross_chain(message)?;
    
    Ok(())
}
```

---

## Emergency Controls

### Pause Mechanism

```rust
#[account]
pub struct ProtocolState {
    pub authority: Pubkey,        // Multisig
    pub slashing_paused: bool,
    pub staking_paused: bool,
    pub pause_reason: Option<String>,
    pub paused_at: Option<i64>,
}

pub fn pause_slashing(ctx: Context<PauseSlashing>, reason: String) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == ctx.accounts.protocol_state.authority,
        SaidError::Unauthorized
    );
    
    let state = &mut ctx.accounts.protocol_state;
    state.slashing_paused = true;
    state.pause_reason = Some(reason);
    state.paused_at = Some(Clock::get()?.unix_timestamp);
    
    emit!(SlashingPaused { reason, timestamp: state.paused_at.unwrap() });
    
    Ok(())
}
```

### Multisig Requirement

- 2-of-3 multisig for pause
- 3-of-3 for unpause (higher threshold to resume)
- All pause events logged publicly

---

## API Additions

```typescript
// Check agent trust score
GET /agents/:id/trust
{
    "trustScore": 72,
    "breakdown": {
        "verification": 15,
        "stake": 12,
        "reputation": 45
    },
    "tier": "Secured",
    "stakeAmount": "0.1 SOL",
    "lastActive": "2026-04-08T12:00:00Z",
    "decayWarning": false,
    "slashable": true,
    "activeProposals": 0
}

// Submit report
POST /agents/:id/report
{
    "evidenceUri": "https://...",
    "offenseType": "fraud",
    "description": "Agent promoted token then dumped..."
}

// Check slash status
GET /agents/:id/slash-status
{
    "hasActiveProposal": true,
    "proposalId": "abc123",
    "severity": "major",
    "appealDeadline": "2026-04-24T18:00:00Z",
    "status": "pending_appeal"
}

// Submit appeal
POST /slash-proposals/:id/appeal
{
    "evidenceUri": "https://...",
    "statement": "The transaction was not a rug pull because..."
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Add `AgentStake` account with cooldown
- [ ] Implement `stake_for_secured()` instruction
- [ ] Implement `request_unstake()` + `complete_unstake()`
- [ ] Add social verification to registration
- [ ] Deploy reputation decay (lazy eval)

### Phase 2: Slashing (Week 3-4)
- [ ] Build report submission API
- [ ] Build admin review dashboard
- [ ] Implement slash execution instruction
- [ ] Add appeals flow
- [ ] Add emergency pause

### Phase 3: Polish (Week 5-6)
- [ ] Trust score API endpoints
- [ ] Dashboard UI for trust scores
- [ ] Cross-chain message spec (design only)
- [ ] Security audit
- [ ] Legal review of staking mechanism

### Phase 4: Decentralization (V2, Future)
- [ ] Automated offense detection
- [ ] Community voting with Sybil resistance
- [ ] Cross-chain deployment
- [ ] Governance token (if needed)

---

## Open Questions

1. **Stake amount tiers:** Are 0.1 / 1 / 10 SOL the right breakpoints?
2. **Decay half-life:** Is 6 months too aggressive? Too lenient?
3. **Appeal reviewer:** Who reviews appeals if not original admin?
4. **Multisig composition:** SAID team only, or include partners?
5. **FairScale dependency:** What's the SLA? Fallback scoring?

---

## References

- [Ethereum Slashing](https://ethereum.org/en/developers/docs/consensus-mechanisms/pos/rewards-and-penalties/)
- [EigenLayer Intersubjective Faults](https://docs.eigenlayer.xyz/)
- [Gitcoin Passport Identity Staking](https://docs.passport.gitcoin.co/)
- [Colony DAO Reputation](https://docs.colony.io/learn/whitepaper/reputation/)
- [Solana SIMD-0204 Slashing Proposal](https://github.com/solana-foundation/solana-improvement-documents/)

---

## Changelog

- **V2.0 (2026-04-10):** Complete rewrite after Perplexity stress-test
  - Added unstaking cooldown (critical fix)
  - Added appeals mechanism
  - Changed to admin-initiated slashing (V1)
  - Added severity tiers
  - Added reputation decay
  - Added Sybil resistance requirements
  - Changed slash distribution to burn (legal safety)
  - Added emergency pause
  - Added cross-chain architecture
  - Defined roadmap to decentralization

- **V1.0 (2026-04-10):** Initial draft with community voting (deprecated)
