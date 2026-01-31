use anchor_lang::prelude::*;

declare_id!("SAiD111111111111111111111111111111111111111");

#[program]
pub mod said {
    use super::*;

    /// Register a new AI agent identity
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        metadata_uri: String,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent_identity;
        agent.owner = ctx.accounts.owner.key();
        agent.metadata_uri = metadata_uri;
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.bump = ctx.bumps.agent_identity;
        
        emit!(AgentRegistered {
            agent_id: agent.key(),
            owner: agent.owner,
            metadata_uri: agent.metadata_uri.clone(),
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
pub struct AgentIdentity {
    pub owner: Pubkey,
    #[max_len(200)]
    pub metadata_uri: String,
    pub created_at: i64,
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
