# Review Priority Details

> Load when performing a detailed code review. Ordered by severity.

## Priority 1: Correctness and Runtime Safety

- Null/undefined access on optional chains
- Missing `await` on async calls (silent promise drops)
- Type narrowing gaps that TS doesn't catch (`as` casts, `any` leaks)
- Off-by-one errors in pagination, array slicing, retry counts
- Race conditions in concurrent Discord command handlers

## Priority 2: Security and Secret Exposure

- `process.env` access outside `config.ts` (breaks centralized secret handling)
- User input flowing into SQL, shell, or file path without sanitization
- Tokens/keys in log output, error messages, or Discord replies
- Missing auth check on API routes
- See: `/security-audit` references for OWASP/STRIDE detail

## Priority 3: Backward Compatibility

- Changed function signatures affecting callers
- Database schema changes without migration path
- Discord command option changes affecting existing users
- Removed or renamed exports
- See: `/implement` references for full compat checklist

## Priority 4: Test Coverage Gaps

- New code paths without corresponding test cases
- Modified behavior without updated assertions
- Error paths that are only tested for the happy case
- Mocking that hides real integration issues

## Priority 5: Operational Risk

- Scheduler changes that affect cron timing
- New startup dependencies that can fail silently
- Log format changes that break monitoring
- Memory/connection pool changes
