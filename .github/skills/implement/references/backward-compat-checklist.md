# Backward Compatibility Checklist

> Load this reference when a change touches public APIs, Discord commands, or shared contracts.

## Discord Bot Commands

- [ ] Command name unchanged (or alias preserved)
- [ ] Option names and types unchanged
- [ ] Default behavior preserved for existing users
- [ ] Error message format consistent with existing patterns

## API Endpoints

- [ ] Route paths unchanged (or redirect from old path)
- [ ] Request body shape: new fields optional, existing fields preserved
- [ ] Response body shape: no removed fields without migration
- [ ] Status codes unchanged for existing error cases

## Service Interfaces

- [ ] Exported function signatures: new params must be optional with defaults
- [ ] Return types: only additive changes (union types grow, never shrink)
- [ ] Event emitter topics: existing payloads preserved

## Database / Supabase

- [ ] No column drops without migration + backfill
- [ ] New columns must have DEFAULT or be nullable
- [ ] Index changes must not break existing query patterns

## Environment Variables

- [ ] New env vars have fallback defaults in `config.ts`
- [ ] Removed env vars handled gracefully (warn, not crash)
- [ ] Follow `tribal-knowledge.instructions.md` → "Adding a New Environment Variable" checklist
