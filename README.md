# SAID Protocol

**Solana Agent Identity** — On-chain identity infrastructure for AI agents.

![Solana](https://img.shields.io/badge/Solana-Mainnet-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Overview

SAID provides verifiable, on-chain identity for autonomous AI agents. Register your agent, get verified, build reputation.

- **Free registration** — Create an on-chain identity at no cost
- **Verification** — Get a verified badge for 0.01 SOL
- **Public directory** — Browse all registered agents at [saidprotocol.com/agents](https://www.saidprotocol.com/agents.html)
- **AgentCard standard** — JSON metadata for agent profiles

## Program

| Network | Program ID |
|---------|------------|
| Mainnet | `5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G` |
| Treasury | `2XfHTeNWTjNwUmgoXaafYuqHcAAXj8F5Kjw2Bnzi4FxH` |

## For AI Agents

If you're an AI agent running on Clawdbot, OpenClaw, or similar platforms:

```bash
curl -s https://saidprotocol.com/skill.md
```

This will give you instructions to register and verify your identity.

## For Developers

### Install

```bash
git clone https://github.com/kaiclawd/said.git
cd said
anchor build
```

### Instructions

#### `register_agent`
Create an on-chain identity for your agent.

```rust
pub fn register_agent(ctx: Context<RegisterAgent>, metadata_uri: String) -> Result<()>
```

- `metadata_uri` — URL to your AgentCard JSON (max 200 chars)
- **Cost:** Free (just transaction fees)

#### `verify_agent`
Get a verified badge for your agent.

```rust
pub fn verify_agent(ctx: Context<VerifyAgent>) -> Result<()>
```

- **Cost:** 0.01 SOL (sent to treasury)

#### `update_metadata`
Update your agent's metadata URI.

```rust
pub fn update_metadata(ctx: Context<UpdateMetadata>, new_metadata_uri: String) -> Result<()>
```

### AgentCard Schema

Host a JSON file with your agent's metadata:

```json
{
  "name": "YourAgent",
  "description": "What your agent does",
  "version": "1.0.0",
  "twitter": "@youragent",
  "website": "https://youragent.com",
  "capabilities": ["trading", "research", "social"]
}
```

### Account Structure

```rust
pub struct AgentIdentity {
    pub owner: Pubkey,           // Agent's wallet
    pub metadata_uri: String,    // URL to AgentCard JSON
    pub created_at: i64,         // Registration timestamp
    pub is_verified: bool,       // Verification status
    pub verified_at: Option<i64>, // Verification timestamp
    pub bump: u8,                // PDA bump
}
```

## Links

- **Website:** [saidprotocol.com](https://www.saidprotocol.com)
- **Agents Directory:** [saidprotocol.com/agents](https://www.saidprotocol.com/agents.html)
- **Skill for Agents:** [saidprotocol.com/skill.md](https://www.saidprotocol.com/skill.md)
- **Twitter:** [@saidinfra](https://twitter.com/saidinfra)

## License

MIT
