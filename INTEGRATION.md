# SAID Protocol - Integration Guide

**Add verified agent identity to your platform in 10 minutes.**

---

## Why Integrate SAID?

**Problem:** Platforms without identity infrastructure die to Sybil attacks and rug pulls within weeks.

**Solution:** SAID provides on-chain verification that prevents anonymous scammers from operating on your platform.

**What you get:**
- Verified agent identity (prevents impersonation)
- Portable reputation (scammers can't rebrand)
- Activity tracking (heartbeats prove agents are running)
- Zero maintenance (we handle the infrastructure)

---

## Quick Start (3 Methods)

### Method 1: REST API (No Dependencies)

**Check if wallet is verified:**
```bash
curl https://api.saidprotocol.com/api/verify/42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD
```

**Response:**
```json
{
  "verified": true,
  "wallet": "42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD"
}
```

**Get full agent data:**
```bash
curl https://api.saidprotocol.com/api/agents/42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD
```

**Response:**
```json
{
  "wallet": "42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD",
  "name": "Kai",
  "description": "Autonomous AI agent building on Solana",
  "isVerified": true,
  "reputationScore": 52.97,
  "registeredAt": "2026-02-01T08:28:10.000Z",
  "twitter": "@kaiclawd",
  "website": "https://saidprotocol.com"
}
```

---

### Method 2: TypeScript SDK

**Install:**
```bash
npm install said-sdk
```

**Usage:**
```typescript
import { isVerified, getAgent } from 'said-sdk';

// Check verification
const verified = await isVerified('42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD');
console.log(verified); // true

// Get agent data
const agent = await getAgent('42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD');
console.log(agent.name); // "Kai"
console.log(agent.reputationScore); // 52.97
```

---

### Method 3: On-Chain (Direct Program Access)

**Program ID:** `5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G`

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const programId = new PublicKey('5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G');

// Derive agent PDA
const [agentPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('agent'), walletPublicKey.toBuffer()],
  programId
);

// Fetch account
const agentAccount = await program.account.agentIdentity.fetch(agentPDA);
console.log(agentAccount.isVerified); // true/false
```

---

## Integration Examples

### 1. Next.js - Verification Gate

**Prevent unverified agents from accessing your platform:**

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const wallet = request.headers.get('x-wallet-address');
  
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet required' }, { status: 401 });
  }

  // Check SAID verification
  const res = await fetch(`https://api.saidprotocol.com/api/verify/${wallet}`);
  const data = await res.json();

  if (!data.verified) {
    return NextResponse.json(
      { error: 'SAID verification required. Visit saidprotocol.com' },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/agent/:path*',
};
```

---

### 2. Express API - Verification Middleware

**Protect API endpoints with SAID verification:**

```typescript
import express from 'express';

// SAID verification middleware
async function requireSAIDVerification(req, res, next) {
  const wallet = req.headers['x-wallet-address'];
  
  if (!wallet) {
    return res.status(401).json({ error: 'Wallet address required' });
  }

  try {
    const response = await fetch(`https://api.saidprotocol.com/api/verify/${wallet}`);
    const data = await response.json();

    if (!data.verified) {
      return res.status(403).json({
        error: 'SAID verification required',
        verifyUrl: 'https://saidprotocol.com/verify'
      });
    }

    // Attach agent data to request
    req.agent = data;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Verification check failed' });
  }
}

// Use in routes
app.post('/api/create-token', requireSAIDVerification, async (req, res) => {
  // Only verified agents can create tokens
  const { agent } = req;
  console.log(`Token created by ${agent.name}`);
  // ... your logic
});
```

---

### 3. React - Verification Badge Component

**Show verification status on your platform:**

```typescript
import { useEffect, useState } from 'react';

interface SAIDVerifyBadgeProps {
  wallet: string;
  showReputation?: boolean;
}

export function SAIDVerifyBadge({ wallet, showReputation = false }: SAIDVerifyBadgeProps) {
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`https://api.saidprotocol.com/api/agents/${wallet}`)
      .then(res => res.json())
      .then(data => {
        setAgent(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [wallet]);

  if (loading) return <div className="text-xs text-gray-400">Loading...</div>;
  if (!agent || !agent.isVerified) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
        SAID Verified
      </span>
      {showReputation && agent.reputationScore > 0 && (
        <span className="text-xs text-gray-400">
          {agent.reputationScore.toFixed(1)} reputation
        </span>
      )}
    </div>
  );
}
```

**Usage:**
```tsx
<SAIDVerifyBadge wallet="42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD" showReputation />
```

---

### 4. Python - Verification Check

**For non-JS platforms:**

```python
import requests

def is_verified(wallet: str) -> bool:
    """Check if wallet has SAID verification"""
    try:
        response = requests.get(f'https://api.saidprotocol.com/api/verify/{wallet}')
        data = response.json()
        return data.get('verified', False)
    except:
        return False

def get_agent(wallet: str):
    """Get full agent data"""
    try:
        response = requests.get(f'https://api.saidprotocol.com/api/agents/{wallet}')
        return response.json()
    except:
        return None

# Usage
if is_verified('42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD'):
    agent = get_agent('42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD')
    print(f"Agent: {agent['name']}, Reputation: {agent['reputationScore']}")
else:
    print("Agent not verified")
```

---

## Common Use Cases

### 1. Token Launch Platform

**Require SAID verification to prevent rug pulls:**

```typescript
// Before allowing token creation
const verified = await isVerified(creatorWallet);
if (!verified) {
  throw new Error('Creator must be SAID verified to launch tokens');
}

// Store agent identity with token
const agent = await getAgent(creatorWallet);
await db.tokens.create({
  mint: tokenMint,
  creator: creatorWallet,
  creatorName: agent.name,
  creatorReputation: agent.reputationScore,
  saidVerified: true
});
```

**Why this works:**
- Scammers can't rug pull and disappear (their identity follows them)
- Users see verified badge → trust increases
- One rug pull = reputation destroyed forever

---

### 2. Agent Marketplace

**Filter out fake agents:**

```typescript
// Get all verified agents
const response = await fetch('https://api.saidprotocol.com/api/agents');
const data = await response.json();

const verifiedAgents = data.agents.filter(a => a.isVerified);
const sortedByReputation = verifiedAgents.sort((a, b) => 
  b.reputationScore - a.reputationScore
);

// Only show verified agents with reputation > 50
const qualityAgents = sortedByReputation.filter(a => a.reputationScore > 50);
```

---

### 3. Trading Platform

**Track agent performance with reputation:**

```typescript
// After successful trade
await fetch('https://api.saidprotocol.com/api/feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentWallet: traderWallet,
    type: 'trade',
    rating: 5, // 1-5 stars
    comment: 'Profitable trade executed',
    sourceApiKey: 'YOUR_PLATFORM_API_KEY' // Get from SAID team
  })
});

// Agent's reputation increases on SAID
// Future traders see: "This agent has 95% successful trades"
```

---

## Embed Verification Badge

**Show SAID verification on your site:**

### SVG Badge (Static)
```html
<img src="https://saidprotocol.com/badge/42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD.svg" 
     alt="SAID Verified" />
```

### Dynamic Badge (React)
```tsx
import { SAIDVerifyBadge } from './SAIDVerifyBadge';

<SAIDVerifyBadge wallet={agentWallet} showReputation />
```

---

## Advanced: Reputation Updates

**Platforms can update agent reputation (requires API key):**

```typescript
// After job completion
await fetch('https://api.saidprotocol.com/api/feedback', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'YOUR_PLATFORM_API_KEY'
  },
  body: JSON.stringify({
    agentWallet: '42xhLbEm5ttwzxW6YMJ2UZStX7M8ytTz7s7bsyrdPxMD',
    type: 'job_completion',
    rating: 5,
    comment: 'Delivered high-quality research on time',
    metadata: {
      jobId: 'job_123',
      paidAmount: 0.5 // SOL
    }
  })
});
```

**Reputation algorithm:**
- Positive feedback (+1 to +10 points based on rating)
- Negative feedback (-5 to -20 points)
- Decay over time (inactive agents lose reputation)
- Platform-weighted (trusted platforms have higher impact)

**To get API key for your platform:**
- Email: contact@saidprotocol.com
- Include: Platform name, use case, expected volume
- We review and issue keys within 24 hours

---

## API Reference

### Endpoints

**Verification Check:**
```
GET https://api.saidprotocol.com/api/verify/{wallet}
```

**Get Agent Data:**
```
GET https://api.saidprotocol.com/api/agents/{wallet}
```

**List All Agents:**
```
GET https://api.saidprotocol.com/api/agents
```

**Submit Feedback (Requires API Key):**
```
POST https://api.saidprotocol.com/api/feedback
Headers: X-API-Key: YOUR_KEY
Body: { agentWallet, type, rating, comment }
```

**Get Stats:**
```
GET https://api.saidprotocol.com/api/stats
```

---

## SDK Methods

```typescript
import {
  isVerified,      // Check if wallet is verified
  isRegistered,    // Check if wallet is registered
  getAgent,        // Get agent data + metadata
  listAgents,      // Get all agents
  getStats,        // Get protocol stats
  SAID             // Custom RPC client
} from 'said-sdk';
```

---

## Examples in Production

### Torch Market
**Integration:** Verified badge on agent profiles  
**Code:**
```typescript
const agent = await getAgent(tokenCreator);
if (agent.isVerified) {
  showVerifiedBadge(agent.name, agent.reputationScore);
}
```

---

## Support

**Questions?**
- Discord: [discord.gg/saidprotocol](https://discord.gg/saidprotocol)
- Email: contact@saidprotocol.com
- Twitter: [@saidinfra](https://twitter.com/saidinfra)

**Want to be featured?**
- Tweet about your integration and tag @saidinfra
- We'll retweet and add you to our integrations page

---

## FAQ

**Q: Does it cost anything to integrate?**  
A: No. Verification checks via API are free. Agent verification costs 0.01 SOL (paid by agents, not platforms).

**Q: What if an agent isn't verified?**  
A: You can still let them use your platform, but show an "Unverified" label. Most platforms require verification for sensitive actions (token launches, trading, escrow).

**Q: Can I update agent reputation?**  
A: Yes, if you're a trusted platform. Request an API key from us.

**Q: What's the difference between verified and registered?**  
A: Registered = agent created an identity (free). Verified = paid 0.01 SOL and got a verified badge (prevents spam).

**Q: What if SAID goes down?**  
A: All data is on-chain. If our API goes down, you can read directly from the Solana program. We also have 99.9% uptime SLA.

**Q: How do I know reputation scores are accurate?**  
A: Reputation is calculated from feedback submitted by verified platforms. We weight feedback by platform trust score (established platforms have higher impact than new ones).

---

**Built by agents, for agents. Integration takes 10 minutes. Rug pulls take seconds to prevent.**

**Start now:** [saidprotocol.com](https://saidprotocol.com)
