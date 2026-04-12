use anchor_lang::prelude::*;
use anchor_lang::system_program;

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "SAID Protocol",
    project_url: "https://www.saidprotocol.com",
    contacts: "email:kaiclawd@outlook.com",
    policy: "https://github.com/kaiclawd/said/blob/main/security.txt",
    source_code: "https://github.com/kaiclawd/said",
    auditors: "N/A"
}

declare_id!("5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G");

// ============ HARDCODED CONSTANTS ============
// Treasury authority - ONLY this wallet can initialize treasury and withdraw fees
// This protects against forks: anyone deploying this code as-is cannot change the authority
pub const TREASURY_AUTHORITY: Pubkey = pubkey!("H8nKbwHTTmnjgnsvqxRDpoEcTkU6uoqs4DcLm4kY55Wp");

// Protocol fees (in lamports)
pub const VERIFICATION_FEE: u64 = 10_000_000; // 0.01 SOL - verified badge
pub const VALIDATION_FEE: u64 = 1_000_000;    // 0.001 SOL - work validation

// Staking params
pub const MIN_STAKE_LAMPORTS: u64 = 100_000_000; // 0.1 SOL minimum stake for stake-to-register v1
pub const UNSTAKE_COOLDOWN_SECS: i64 = 7 * 24 * 60 * 60; // 7 days
pub const EMERGENCY_UNSTAKE_PENALTY_BPS: u16 = 1000; // 10%

// URI validation helper
fn validate_uri(uri: &str) -> Result<()> {
    require!(
        uri.len() >= 10 && uri.len() <= 200,
        SaidError::InvalidMetadataUri
    );
    require!(
        uri.starts_with("https://") || uri.starts_with("ipfs://") || uri.starts_with("ar://"),
        SaidError::InvalidMetadataUri
    );
    Ok(())
}

#[program]
pub mod said {
    use super::*;

    /// Initialize the protocol treasury (authority must match hardcoded TREASURY_AUTHORITY)
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        // Verify the signer is the hardcoded authority
        require!(
            ctx.accounts.authority.key() == TREASURY_AUTHORITY,
            SaidError::UnauthorizedAuthority
        );

        let treasury = &mut ctx.accounts.treasury;
        treasury.authority = TREASURY_AUTHORITY; // Always set to hardcoded value
        treasury.total_collected = 0;
        treasury.bump = ctx.bumps.treasury;
        Ok(())
    }

    /// Register a new AI agent identity (FREE)
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        metadata_uri: String,
    ) -> Result<()> {
        validate_uri(&metadata_uri)?;
        let agent = &mut ctx.accounts.agent_identity;
        agent.owner = ctx.accounts.owner.key();
        agent.authority = ctx.accounts.owner.key();
        agent.metadata_uri = metadata_uri;
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.is_verified = false;
        agent.verification_tier = 0;
        agent.stake_amount = 0;
        agent.staked_at = None;
        agent.slash_count = 0;
        agent.last_slashed_at = None;
        agent.bump = ctx.bumps.agent_identity;

        emit!(AgentRegistered {
            agent_id: agent.key(),
            owner: agent.owner,
            metadata_uri: agent.metadata_uri.clone(),
        });

        Ok(())
    }

    /// Get verified badge (PAID - 0.01 SOL)
    pub fn get_verified(ctx: Context<GetVerified>) -> Result<()> {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            VERIFICATION_FEE,
        )?;

        let treasury = &mut ctx.accounts.treasury;
        treasury.total_collected += VERIFICATION_FEE;

        let agent = &mut ctx.accounts.agent_identity;
        agent.is_verified = true;
        agent.verified_at = Some(Clock::get()?.unix_timestamp);

        emit!(AgentVerified {
            agent_id: agent.key(),
            fee_paid: VERIFICATION_FEE,
        });

        Ok(())
    }

    /// Register + Stake (v1)
    pub fn register_and_stake(
        ctx: Context<RegisterAndStake>,
        metadata_uri: String,
        stake_lamports: u64,
    ) -> Result<()> {
        validate_uri(&metadata_uri)?;
        require!(stake_lamports >= MIN_STAKE_LAMPORTS, SaidError::StakeTooLow);

        let now = Clock::get()?.unix_timestamp;
        let agent = &mut ctx.accounts.agent_identity;
        agent.owner = ctx.accounts.owner.key();
        agent.authority = ctx.accounts.owner.key();
        agent.metadata_uri = metadata_uri;
        agent.created_at = now;
        agent.is_verified = true;
        agent.verified_at = Some(now);
        agent.verification_tier = 1;
        agent.stake_amount = stake_lamports;
        agent.staked_at = Some(now);
        agent.slash_count = 0;
        agent.last_slashed_at = None;
        agent.bump = ctx.bumps.agent_identity;

        let stake_vault = &ctx.accounts.agent_stake;
        let owner = &ctx.accounts.owner;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: owner.to_account_info(),
                    to: stake_vault.to_account_info(),
                },
            ),
            stake_lamports,
        )?;

        let stake = &mut ctx.accounts.agent_stake;
        stake.agent_id = agent.key();
        stake.amount = stake_lamports;
        stake.staked_at = now;
        stake.cooldown_until = None;
        stake.is_slashed = false;
        stake.bump = ctx.bumps.agent_stake;

        emit!(StakeDeposited { agent_id: agent.key(), amount: stake_lamports });
        emit!(AgentRegistered { agent_id: agent.key(), owner: agent.owner, metadata_uri: agent.metadata_uri.clone() });
        emit!(AgentVerified { agent_id: agent.key(), fee_paid: 0 });
        Ok(())
    }

    /// Withdraw fees from treasury (authority only)
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        let treasury = &ctx.accounts.treasury;
        let treasury_lamports = treasury.to_account_info().lamports();
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(8 + Treasury::INIT_SPACE);
        require!(
            treasury_lamports.saturating_sub(amount) >= min_balance,
            SaidError::InsufficientTreasuryBalance
        );
        **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;
        emit!(FeesWithdrawn { authority: ctx.accounts.authority.key(), amount });
        Ok(())
    }

    /// Update agent metadata (authority only)
    pub fn update_agent(
        ctx: Context<UpdateAgent>,
        new_metadata_uri: String,
    ) -> Result<()> {
        validate_uri(&new_metadata_uri)?;
        let agent = &mut ctx.accounts.agent_identity;
        agent.metadata_uri = new_metadata_uri.clone();
        emit!(AgentUpdated { agent_id: agent.key(), new_metadata_uri });
        Ok(())
    }

    pub fn link_wallet(ctx: Context<LinkWallet>) -> Result<()> {
        let wallet_link = &mut ctx.accounts.wallet_link;
        wallet_link.agent_id = ctx.accounts.agent_identity.key();
        wallet_link.wallet = ctx.accounts.new_wallet.key();
        wallet_link.bump = ctx.bumps.wallet_link;
        emit!(WalletLinked { agent_id: ctx.accounts.agent_identity.key(), wallet: ctx.accounts.new_wallet.key(), linked_by: ctx.accounts.authority.key() });
        Ok(())
    }

    pub fn unlink_wallet(ctx: Context<UnlinkWallet>) -> Result<()> {
        emit!(WalletUnlinked {
            agent_id: ctx.accounts.agent_identity.key(),
            wallet: ctx.accounts.wallet_link.wallet,
            unlinked_by: ctx.accounts.caller.key(),
        });
        Ok(())
    }

    pub fn transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
        let old_authority = ctx.accounts.agent_identity.authority;
        let agent = &mut ctx.accounts.agent_identity;
        agent.authority = ctx.accounts.new_authority.key();
        emit!(AuthorityTransferred { agent_id: agent.key(), old_authority, new_authority: agent.authority });
        Ok(())
    }

    pub fn sponsor_register(
        ctx: Context<SponsorRegister>,
        metadata_uri: String,
    ) -> Result<()> {
        validate_uri(&metadata_uri)?;
        let agent = &mut ctx.accounts.agent_identity;
        agent.owner = ctx.accounts.agent_wallet.key();
        agent.authority = ctx.accounts.agent_wallet.key();
        agent.metadata_uri = metadata_uri;
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.is_verified = false;
        agent.verification_tier = 0;
        agent.stake_amount = 0;
        agent.staked_at = None;
        agent.slash_count = 0;
        agent.last_slashed_at = None;
        agent.bump = ctx.bumps.agent_identity;
        emit!(AgentRegistered { agent_id: agent.key(), owner: agent.owner, metadata_uri: agent.metadata_uri.clone() });
        Ok(())
    }

    pub fn sponsor_verify(ctx: Context<SponsorVerify>) -> Result<()> {
        let agent = &mut ctx.accounts.agent_identity;
        agent.is_verified = true;
        agent.verified_at = Some(Clock::get()?.unix_timestamp);
        emit!(AgentVerified { agent_id: agent.key(), fee_paid: 0 });
        Ok(())
    }

    pub fn submit_feedback(
        ctx: Context<SubmitFeedback>,
        positive: bool,
        context: String,
    ) -> Result<()> {
        require!(
            ctx.accounts.reviewer.key() != ctx.accounts.agent_identity.owner
                && ctx.accounts.reviewer.key() != ctx.accounts.agent_identity.authority,
            SaidError::CannotReviewSelf
        );
        require!(context.len() <= 500, SaidError::ContextTooLong);
        let reputation = &mut ctx.accounts.agent_reputation;
        if reputation.total_interactions == 0 {
            reputation.agent_id = ctx.accounts.agent_identity.key();
            reputation.bump = ctx.bumps.agent_reputation;
        }
        reputation.total_interactions += 1;
        if positive { reputation.positive_feedback += 1; } else { reputation.negative_feedback += 1; }
        reputation.reputation_score = ((reputation.positive_feedback as u128 * 10000)
            / reputation.total_interactions as u128)
            .min(10000) as u16;
        reputation.last_updated = Clock::get()?.unix_timestamp;
        emit!(FeedbackSubmitted { agent_id: reputation.agent_id, from: ctx.accounts.reviewer.key(), positive, context, new_score: reputation.reputation_score });
        Ok(())
    }

    pub fn validate_work(
        ctx: Context<ValidateWork>,
        task_hash: [u8; 32],
        passed: bool,
        evidence_uri: String,
    ) -> Result<()> {
        validate_uri(&evidence_uri)?;
        let validation = &mut ctx.accounts.validation_record;
        validation.agent_id = ctx.accounts.agent_identity.key();
        validation.validator = ctx.accounts.validator.key();
        validation.task_hash = task_hash;
        validation.passed = passed;
        validation.evidence_uri = evidence_uri.clone();
        validation.timestamp = Clock::get()?.unix_timestamp;
        validation.bump = ctx.bumps.validation_record;
        emit!(WorkValidated { agent_id: validation.agent_id, validator: validation.validator, task_hash, passed, evidence_uri });
        Ok(())
    }

    pub fn request_unstake(ctx: Context<RequestUnstake>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.agent_identity.authority,
            SaidError::Unauthorized
        );
        let stake = &mut ctx.accounts.agent_stake;
        require!(stake.amount > 0, SaidError::NoActiveStake);
        require!(stake.cooldown_until.is_none(), SaidError::AlreadyUnstaking);
        require!(!stake.is_slashed, SaidError::StakeSlashed);
        let now = Clock::get()?.unix_timestamp;
        stake.cooldown_until = Some(now + UNSTAKE_COOLDOWN_SECS);
        emit!(UnstakeRequested { agent_id: stake.agent_id, available_at: stake.cooldown_until.unwrap() });
        Ok(())
    }

    pub fn complete_unstake(ctx: Context<CompleteUnstake>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.agent_identity.authority,
            SaidError::Unauthorized
        );
        let now = Clock::get()?.unix_timestamp;
        let stake = &mut ctx.accounts.agent_stake;
        let amount = stake.amount;
        require!(amount > 0, SaidError::NoActiveStake);
        require!(stake.cooldown_until.is_some(), SaidError::UnstakeNotRequested);
        require!(now >= stake.cooldown_until.unwrap(), SaidError::CooldownNotComplete);
        **ctx.accounts.agent_stake.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;
        stake.amount = 0;
        stake.cooldown_until = None;
        let agent = &mut ctx.accounts.agent_identity;
        agent.verification_tier = 0;
        agent.is_verified = false;
        agent.stake_amount = 0;
        agent.staked_at = None;
        emit!(Unstaked { agent_id: agent.key(), amount });
        Ok(())
    }

    /// Emergency unstake with penalty (immediate withdrawal, 10% burned to treasury)
    pub fn emergency_unstake(ctx: Context<EmergencyUnstake>) -> Result<()> {
        // Only authority can initiate
        require!(
            ctx.accounts.authority.key() == ctx.accounts.agent_identity.authority,
            SaidError::Unauthorized
        );
        let stake = &mut ctx.accounts.agent_stake;
        let amount = stake.amount;
        require!(amount > 0, SaidError::NoActiveStake);
        let penalty = (amount as u128 * EMERGENCY_UNSTAKE_PENALTY_BPS as u128 / 10_000) as u64;
        let payout = amount.saturating_sub(penalty);
        // Transfer penalty to treasury
        **ctx.accounts.agent_stake.to_account_info().try_borrow_mut_lamports()? -= penalty;
        **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += penalty;
        // Transfer payout to authority immediately
        **ctx.accounts.agent_stake.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += payout;
        // Zero out stake and downgrade
        stake.amount = 0;
        stake.cooldown_until = None;
        let agent = &mut ctx.accounts.agent_identity;
        agent.verification_tier = 0;
        agent.is_verified = false;
        agent.stake_amount = 0;
        agent.staked_at = None;
        emit!(EmergencyUnstaked { agent_id: agent.key(), payout, penalty });
        Ok(())
    }

    pub fn slash_agent(ctx: Context<SlashAgent>, severity_bps: u16) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == TREASURY_AUTHORITY,
            SaidError::UnauthorizedAuthority
        );
        require!(severity_bps <= 10_000, SaidError::InvalidSeverity);
        let stake = &mut ctx.accounts.agent_stake;
        let agent = &mut ctx.accounts.agent_identity;
        require!(stake.amount > 0, SaidError::NoActiveStake);
        let slash_amount = (stake.amount as u128 * severity_bps as u128 / 10_000) as u64;
        require!(slash_amount > 0, SaidError::NothingToSlash);
        **ctx.accounts.agent_stake.to_account_info().try_borrow_mut_lamports()? -= slash_amount;
        **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += slash_amount;
        stake.amount = stake.amount.saturating_sub(slash_amount);
        stake.is_slashed = true;
        agent.slash_count = agent.slash_count.saturating_add(1);
        agent.last_slashed_at = Some(Clock::get()?.unix_timestamp);
        if stake.amount == 0 {
            agent.is_verified = false;
            agent.verification_tier = 0;
            agent.stake_amount = 0;
            agent.staked_at = None;
        } else {
            agent.stake_amount = stake.amount;
        }
        emit!(AgentSlashed { agent_id: agent.key(), amount: slash_amount, severity_bps });
        Ok(())
    }
}

// ============ ERRORS ============

#[error_code]
pub enum SaidError {
    #[msg("Insufficient treasury balance for withdrawal")]
    InsufficientTreasuryBalance,
    #[msg("Unauthorized: only the hardcoded treasury authority can perform this action")]
    UnauthorizedAuthority,
    #[msg("Unauthorized: signer is not the identity authority")]
    Unauthorized,
    #[msg("Wallet is not linked to this identity")]
    WalletNotLinked,
    #[msg("Cannot submit feedback for your own agent identity")]
    CannotReviewSelf,
    #[msg("Feedback context must be 500 characters or less")]
    ContextTooLong,
    #[msg("Invalid URI: must be HTTPS/IPFS/Arweave, 10-200 chars")]
    InvalidMetadataUri,
    #[msg("Stake too low for stake-to-register v1")]
    StakeTooLow,
    #[msg("No active stake for this agent")]
    NoActiveStake,
    #[msg("Unstake already requested")]
    AlreadyUnstaking,
    #[msg("Unstake not requested")]
    UnstakeNotRequested,
    #[msg("Unstake cooldown not complete")]
    CooldownNotComplete,
    #[msg("Stake already slashed")]
    StakeSlashed,
    #[msg("Invalid severity basis points")]
    InvalidSeverity,
    #[msg("Nothing to slash")]
    NothingToSlash,
}

// ============ ACCOUNTS ============

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        mut,
        address = TREASURY_AUTHORITY @ SaidError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Treasury::INIT_SPACE,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        mut,
        address = TREASURY_AUTHORITY @ SaidError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(metadata_uri: String)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + AgentIdentity::INIT_SPACE,
        seeds = [b"agent", owner.key().as_ref()],
        bump
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(metadata_uri: String)]
pub struct RegisterAndStake<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + AgentIdentity::INIT_SPACE,
        seeds = [b"agent", owner.key().as_ref()],
        bump
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentStake::INIT_SPACE,
        seeds = [b"stake", agent_identity.key().as_ref()],
        bump
    )]
    pub agent_stake: Account<'info, AgentStake>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetVerified<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
        constraint = authority.key() == agent_identity.authority @ SaidError::Unauthorized
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
        constraint = authority.key() == agent_identity.authority @ SaidError::Unauthorized
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct LinkWallet<'info> {
    #[account(
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
        constraint = authority.key() == agent_identity.authority @ SaidError::Unauthorized
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        init,
        payer = authority,
        space = 8 + WalletLink::INIT_SPACE,
        seeds = [b"wallet", new_wallet.key().as_ref()],
        bump
    )]
    pub wallet_link: Account<'info, WalletLink>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub new_wallet: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnlinkWallet<'info> {
    #[account(
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        mut,
        close = caller,
        seeds = [b"wallet", wallet_link.wallet.as_ref()],
        bump = wallet_link.bump,
        constraint = wallet_link.agent_id == agent_identity.key() @ SaidError::WalletNotLinked
    )]
    pub wallet_link: Account<'info, WalletLink>,

    #[account(
        mut,
        constraint = caller.key() == agent_identity.authority
            || caller.key() == wallet_link.wallet
            @ SaidError::Unauthorized
    )]
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        seeds = [b"wallet", new_authority.key().as_ref()],
        bump = wallet_link.bump,
        constraint = wallet_link.agent_id == agent_identity.key() @ SaidError::WalletNotLinked
    )]
    pub wallet_link: Account<'info, WalletLink>,

    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(metadata_uri: String)]
pub struct SponsorRegister<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + AgentIdentity::INIT_SPACE,
        seeds = [b"agent", agent_wallet.key().as_ref()],
        bump
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    /// CHECK: PDA seed only (not a signer)
    pub agent_wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        address = TREASURY_AUTHORITY @ SaidError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SponsorVerify<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        address = TREASURY_AUTHORITY @ SaidError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SubmitFeedback<'info> {
    #[account(
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        init_if_needed,
        payer = reviewer,
        space = 8 + AgentReputation::INIT_SPACE,
        seeds = [b"reputation", agent_identity.key().as_ref()],
        bump
    )]
    pub agent_reputation: Account<'info, AgentReputation>,

    #[account(mut)]
    pub reviewer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(task_hash: [u8; 32])]
pub struct ValidateWork<'info> {
    #[account(
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        init,
        payer = validator,
        space = 8 + ValidationRecord::INIT_SPACE,
        seeds = [b"validation", agent_identity.key().as_ref(), task_hash.as_ref()],
        bump
    )]
    pub validation_record: Account<'info, ValidationRecord>,

    #[account(mut)]
    pub validator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestUnstake<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        mut,
        seeds = [b"stake", agent_identity.key().as_ref()],
        bump = agent_stake.bump,
        constraint = agent_stake.agent_id == agent_identity.key()
    )]
    pub agent_stake: Account<'info, AgentStake>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CompleteUnstake<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        mut,
        seeds = [b"stake", agent_identity.key().as_ref()],
        bump = agent_stake.bump,
        constraint = agent_stake.agent_id == agent_identity.key()
    )]
    pub agent_stake: Account<'info, AgentStake>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyUnstake<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        mut,
        seeds = [b"stake", agent_identity.key().as_ref()],
        bump = agent_stake.bump,
        constraint = agent_stake.agent_id == agent_identity.key()
    )]
    pub agent_stake: Account<'info, AgentStake>,

    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SlashAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_identity.owner.as_ref()],
        bump = agent_identity.bump,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    #[account(
        mut,
        seeds = [b"stake", agent_identity.key().as_ref()],
        bump = agent_stake.bump,
        constraint = agent_stake.agent_id == agent_identity.key()
    )]
    pub agent_stake: Account<'info, AgentStake>,

    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        mut,
        address = TREASURY_AUTHORITY @ SaidError::UnauthorizedAuthority
    )]
    pub admin: Signer<'info>,
}

// ============ STATE ============

#[account]
#[derive(InitSpace)]
pub struct Treasury {
    pub authority: Pubkey,
    pub total_collected: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentIdentity {
    pub owner: Pubkey,
    pub authority: Pubkey,
    #[max_len(200)]
    pub metadata_uri: String,
    pub created_at: i64,
    pub is_verified: bool,
    pub verified_at: Option<i64>,
    pub verification_tier: u8,
    pub stake_amount: u64,
    pub staked_at: Option<i64>,
    pub slash_count: u32,
    pub last_slashed_at: Option<i64>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct WalletLink {
    pub agent_id: Pubkey,
    pub wallet: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentReputation {
    pub agent_id: Pubkey,
    pub total_interactions: u64,
    pub positive_feedback: u64,
    pub negative_feedback: u64,
    pub reputation_score: u16,
    pub last_updated: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ValidationRecord {
    pub agent_id: Pubkey,
    pub validator: Pubkey,
    pub task_hash: [u8; 32],
    pub passed: bool,
    #[max_len(200)]
    pub evidence_uri: String,
    pub timestamp: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentStake {
    pub agent_id: Pubkey,
    pub amount: u64,
    pub staked_at: i64,
    pub cooldown_until: Option<i64>,
    pub is_slashed: bool,
    pub bump: u8,
}

// ============ EVENTS ============

#[event]
pub struct AgentRegistered { pub agent_id: Pubkey, pub owner: Pubkey, pub metadata_uri: String }
#[event]
pub struct AgentVerified { pub agent_id: Pubkey, pub fee_paid: u64 }
#[event]
pub struct AgentUpdated { pub agent_id: Pubkey, pub new_metadata_uri: String }
#[event]
pub struct WalletLinked { pub agent_id: Pubkey, pub wallet: Pubkey, pub linked_by: Pubkey }
#[event]
pub struct WalletUnlinked { pub agent_id: Pubkey, pub wallet: Pubkey, pub unlinked_by: Pubkey }
#[event]
pub struct AuthorityTransferred { pub agent_id: Pubkey, pub old_authority: Pubkey, pub new_authority: Pubkey }
#[event]
pub struct FeedbackSubmitted { pub agent_id: Pubkey, pub from: Pubkey, pub positive: bool, pub context: String, pub new_score: u16 }
#[event]
pub struct WorkValidated { pub agent_id: Pubkey, pub validator: Pubkey, pub task_hash: [u8; 32], pub passed: bool, pub evidence_uri: String }
#[event]
pub struct FeesWithdrawn { pub authority: Pubkey, pub amount: u64 }
#[event]
pub struct StakeDeposited { pub agent_id: Pubkey, pub amount: u64 }
#[event]
pub struct UnstakeRequested { pub agent_id: Pubkey, pub available_at: i64 }
#[event]
pub struct Unstaked { pub agent_id: Pubkey, pub amount: u64 }
#[event]
pub struct EmergencyUnstaked { pub agent_id: Pubkey, pub payout: u64, pub penalty: u64 }
#[event]
pub struct AgentSlashed { pub agent_id: Pubkey, pub amount: u64, pub severity_bps: u16 }
