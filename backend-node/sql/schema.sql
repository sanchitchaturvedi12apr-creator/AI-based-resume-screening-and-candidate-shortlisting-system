CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT NOT NULL AUTO_INCREMENT,
    title VARCHAR(160) NOT NULL,
    department VARCHAR(100) NOT NULL,
    location VARCHAR(160) NOT NULL,
    employment_type VARCHAR(24) NOT NULL,
    description TEXT NOT NULL,
    min_experience_years INT NULL,
    max_experience_years INT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_jobs_status_created (status, created_at),
    INDEX idx_jobs_department (department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS job_required_skills (
    job_id BIGINT NOT NULL,
    skill_order INT NOT NULL,
    skill VARCHAR(100) NOT NULL,
    PRIMARY KEY (job_id, skill_order),
    CONSTRAINT uk_job_required_skill UNIQUE (job_id, skill),
    CONSTRAINT fk_job_required_skills_job FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS job_preferred_skills (
    job_id BIGINT NOT NULL,
    skill_order INT NOT NULL,
    skill VARCHAR(100) NOT NULL,
    PRIMARY KEY (job_id, skill_order),
    CONSTRAINT uk_job_preferred_skill UNIQUE (job_id, skill),
    CONSTRAINT fk_job_preferred_skills_job FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS candidates (
    id BIGINT NOT NULL AUTO_INCREMENT,
    full_name VARCHAR(160) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(40) NULL,
    location VARCHAR(160) NULL,
    experience_years INT NULL,
    profile_summary TEXT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_candidates_email UNIQUE (email),
    INDEX idx_candidates_name (full_name),
    INDEX idx_candidates_location (location)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS resumes (
    id BIGINT NOT NULL AUTO_INCREMENT,
    candidate_id BIGINT NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    content_type VARCHAR(120) NOT NULL,
    size_bytes BIGINT NOT NULL,
    extracted_text LONGTEXT NULL,
    processing_status VARCHAR(20) NOT NULL DEFAULT 'UPLOADED',
    processing_error VARCHAR(1000) NULL,
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_resumes_storage_key UNIQUE (storage_key),
    CONSTRAINT fk_resumes_candidate FOREIGN KEY (candidate_id) REFERENCES candidates (id),
    INDEX idx_resumes_candidate_uploaded (candidate_id, created_at),
    INDEX idx_resumes_processing_status (processing_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS resume_skills (
    resume_id BIGINT NOT NULL,
    skill_order INT NOT NULL,
    skill VARCHAR(100) NOT NULL,
    PRIMARY KEY (resume_id, skill_order),
    CONSTRAINT uk_resume_skill UNIQUE (resume_id, skill),
    CONSTRAINT fk_resume_skills_resume FOREIGN KEY (resume_id) REFERENCES resumes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS applications (
    id BIGINT NOT NULL AUTO_INCREMENT,
    candidate_id BIGINT NOT NULL,
    job_id BIGINT NOT NULL,
    resume_id BIGINT NULL,
    review_status VARCHAR(20) NOT NULL DEFAULT 'NEW',
    match_score INT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_application_candidate_job UNIQUE (candidate_id, job_id),
    CONSTRAINT fk_applications_candidate FOREIGN KEY (candidate_id) REFERENCES candidates (id),
    CONSTRAINT fk_applications_job FOREIGN KEY (job_id) REFERENCES jobs (id),
    CONSTRAINT fk_applications_resume FOREIGN KEY (resume_id) REFERENCES resumes (id),
    INDEX idx_applications_job_status_created (job_id, review_status, created_at),
    INDEX idx_applications_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_results (
    id BIGINT NOT NULL AUTO_INCREMENT,
    application_id BIGINT NOT NULL,
    algorithm_version VARCHAR(40) NOT NULL,
    score TINYINT UNSIGNED NULL,
    breakdown JSON NOT NULL,
    calculated_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_match_results_application UNIQUE (application_id),
    CONSTRAINT fk_match_results_application FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
    INDEX idx_match_results_score (score, calculated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS recruiter_users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    full_name VARCHAR(160) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    role VARCHAR(24) NOT NULL DEFAULT 'RECRUITER',
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_recruiter_users_email UNIQUE (email),
    INDEX idx_recruiter_users_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
