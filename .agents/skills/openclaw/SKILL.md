```markdown
# openclaw Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `openclaw` TypeScript codebase. It covers file and code style, commit practices, and testing patterns to help contributors write consistent, high-quality code. While no automated workflows were detected, this guide provides suggested commands and step-by-step instructions for common development tasks.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myModule.ts`, `userService.ts`

### Import Style
- Use **relative imports** for referencing other modules.
  - Example:
    ```typescript
    import { helperFunction } from './utils';
    ```

### Export Style
- Use **named exports** instead of default exports.
  - Example:
    ```typescript
    // In userService.ts
    export function getUser() { ... }
    export const USER_ROLE = 'admin';

    // In another file
    import { getUser, USER_ROLE } from './userService';
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use prefixes such as `build`.
- Example:
  ```
  build: update TypeScript version to 4.9.5 for compatibility
  ```

## Workflows

### Creating a New Module
**Trigger:** When adding a new feature or utility
**Command:** `/create-module`

1. Create a new file using camelCase naming (e.g., `featureHandler.ts`).
2. Write your module code using named exports.
3. Use relative imports for dependencies.
4. Add or update corresponding test files (`featureHandler.test.ts`).
5. Commit changes using the conventional commit format.

### Running Tests
**Trigger:** Before pushing or merging changes
**Command:** `/run-tests`

1. Identify test files matching the `*.test.*` pattern.
2. Run the test suite using your preferred test runner (e.g., `npm test` or `yarn test`).
3. Ensure all tests pass before proceeding.

### Making a Build-related Change
**Trigger:** When updating dependencies or build scripts
**Command:** `/build-update`

1. Make the necessary changes to build configurations or dependencies.
2. Commit with a `build:` prefix in the commit message.
3. Run tests to verify build stability.

## Testing Patterns

- Test files use the `*.test.*` naming convention (e.g., `userService.test.ts`).
- The specific testing framework is not detected; use your project's standard test runner.
- Example test file structure:
  ```typescript
  import { getUser } from './userService';

  describe('getUser', () => {
    it('should return a user object', () => {
      const user = getUser('alice');
      expect(user).toBeDefined();
    });
  });
  ```

## Commands
| Command         | Purpose                                            |
|-----------------|---------------------------------------------------|
| /create-module  | Scaffold a new module with proper conventions     |
| /run-tests      | Run all test files matching `*.test.*`            |
| /build-update   | Make and commit build-related changes             |
```
