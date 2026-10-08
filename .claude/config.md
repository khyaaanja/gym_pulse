Claude Code Configuration for GymPulse
======================================

Project: GymPulse - Gym Management Platform
Version: 0.1.0

Configuration Settings:
- autoApprove: false
- allowTextSubmission: true
- projectType: fullstack-nextjs
- framework: nextjs-16
- packageManager: npm

Enabled Skills:
- brag
- docs
- pdf
- xlsx
- report
- graphify

Project Context:
GymPulse is a SaaS gym management platform with features including:
- Member check-in/QR code scanning
- Attendance tracking with streaks and rewards
- Marketplace for services and merchandise
- Risk prediction for member retention
- Payment processing and financial reporting

Directories:
- src/ - Source code
- prisma/ - Database schema and migrations
- public/ - Static assets
- docs/ - Documentation files

Key Dependencies:
- next@16.3.6
- prisma@7.10.0
- react@19.2.8
- react-dom@19.2.8
- tailwindcss@4
- typescript@5

Scripts Available:
- dev: next dev
- build: next build
- start: next start
- lint: eslint
- typecheck: tsc --noEmit
- test: vitest run
- worker: tsx --tsconfig tsconfig.json src/workers/index.ts