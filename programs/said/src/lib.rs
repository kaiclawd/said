use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("SAiD111111111111111111111111111111111111111");

// ============ HARDCODED CONSTANTS ============
// Treasury authority - ONLY this wallet can initialize treasury and withdraw fees
// This protects against forks: anyone deploying this code as-is cannot change the authority
pub const TREASURY_AUTHORITY: Pubkey = pubkey!("H8nKbwHTTmnjgnsvqxRDpoEcTkU6uoqs4DcLm4kY55Wp");

// Protocol fees (in lamports)
pub const VERIFICATION_FEE: u64 = 10_000_000; // 0.01 SOL - verified badge
pub const VALIDATION_FEE: u64 = 1_000_000;    // 0.001 SOL - work validation

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
        let agent = &mut ctx.accounts.agent_identity;
        agent.owner = ctx.accounts.owner.key();
        agent.metadata_uri = metadata_uri;
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.is_verified = false;
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
        // Transfer verification fee to treasury
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
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

    /// Withdraw fees from treasury (authority only)
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        let treasury = &ctx.accounts.treasury;
        let treasury_lamports = treasury.to_account_info().lamports();
        
        // Keep minimum rent in treasury
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(8 + Treasury::INIT_SPACE);
        
        require!(
            treasury_lamports.saturating_sub(amount) >= min_balance,
            SaidError::InsufficientTreasuryBalance
        );
        
        **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;
        
        emit!(FeesWithdrawn {
            authority: ctx.accounts.authority.key(),
            amount,
        });
        
        Ok(())
    }

    /// Update agent metadata
    pub fn update_agent(
        ctx: Context<UpdateAgent>,
        new_metadata_uri: String,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent_identity;
        agent.metadata_uri = new_metadata_uri.clone();
        
        emit!(AgentUpdated {
            agent_id: agent.key(),
            new_metadata_uri,
        });
        
        Ok(())
    }

    /// Submit feedback for an agent (affects reputation)
    pub fn submit_feedback(
        ctx: Context<SubmitFeedback>,
        positive: bool,
        context: String,
    ) -> Result<()> {
        let reputation = &mut ctx.accounts.agent_reputation;
        
        // Initialize if first feedback
        if reputation.total_interactions == 0 {
            reputation.agent_id = ctx.accounts.agent_identity.key();
            reputation.bump = ctx.bumps.agent_reputation;
        }
        
        reputation.total_interactions += 1;
        if positive {
            reputation.positive_feedback += 1;
        } else {
            reputation.negative_feedback += 1;
        }
        
        // Calculate score (basis points, 0-10000)
        reputation.reputation_score = ((reputation.positive_feedback as u64 * 10000) 
            / reputation.total_interactions) as u16;
        reputation.last_updated = Clock::get()?.unix_timestamp;
        
        emit!(FeedbackSubmitted {
            agent_id: reputation.agent_id,
            from: ctx.accounts.reviewer.key(),
            positive,
            context,
            new_score: reputation.reputation_score,
        });
        
        Ok(())
    }

    /// Validate agent work (third-party attestation)
    pub fn validate_work(
        ctx: Context<ValidateWork>,
        task_hash: [u8; 32],
        passed: bool,
        evidence_uri: String,
    ) -> Result<()> {
        let validation = &mut ctx.accounts.validation_record;
        validation.agent_id = ctx.accounts.agent_identity.key();
        validation.validator = ctx.accounts.validator.key();
        validation.task_hash = task_hash;
        validation.passed = passed;
        validation.evidence_uri = evidence_uri.clone();
        validation.timestamp = Clock::get()?.unix_timestamp;
        validation.bump = ctx.bumps.validation_record;
        
        emit!(WorkValidated {
            agent_id: validation.agent_id,
            validator: validation.validator,
            task_hash,
            passed,
            evidence_uri,
        });
        
        Ok(())
    }
}

// ============ ACCOUNTS ============

#[error_code]
pub enum SaidError {
    #[msg("Insufficient treasury balance for withdrawal")]
    InsufficientTreasuryBalance,
    #[msg("Unauthorized: only the hardcoded treasury authority can perform this action")]
    UnauthorizedAuthority,
}

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
pub struct GetVerified<'info> {
    #[account(
        mut,
        seeds = [b"agent", owner.key().as_ref()],
        bump = agent_identity.bump,
        has_one = owner
    )]
    pub agent_identity: Account<'info, AgentIdentity>,
    
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", owner.key().as_ref()],
        bump = agent_identity.bump,
        has_one = owner
    )]
    pub agent_identity: Account<'info, AgentIdentity>,
    
    pub owner: Signer<'info>,
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
    #[max_len(200)]
    pub metadata_uri: String,
    pub created_at: i64,
    pub is_verified: bool,
    pub verified_at: Option<i64>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentReputation {
    pub agent_id: Pubkey,
    pub total_interactions: u64,
    pub positive_feedback: u64,
    pub negative_feedback: u64,
    pub reputation_score: u16,  // 0-10000 basis points
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

// ============ EVENTS ============

#[event]
pub struct AgentRegistered {
    pub agent_id: Pubkey,
    pub owner: Pubkey,
    pub metadata_uri: String,
}

#[event]
pub struct AgentVerified {
    pub agent_id: Pubkey,
    pub fee_paid: u64,
}

#[event]
pub struct AgentUpdated {
    pub agent_id: Pubkey,
    pub new_metadata_uri: String,
}

#[event]
pub struct FeedbackSubmitted {
    pub agent_id: Pubkey,
    pub from: Pubkey,
    pub positive: bool,
    pub context: String,
    pub new_score: u16,
}

#[event]
pub struct WorkValidated {
    pub agent_id: Pubkey,
    pub validator: Pubkey,
    pub task_hash: [u8; 32],
    pub passed: bool,
    pub evidence_uri: String,
}

#[event]
pub struct FeesWithdrawn {
    pub authority: Pubkey,
    pub amount: u64,
}
