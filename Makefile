.PHONY: install dev typecheck lint test build package e2e ci clean

install:
	pnpm install --frozen-lockfile

dev:
	pnpm --filter @arlo/desktop dev

typecheck:
	pnpm typecheck

lint:
	pnpm lint

test:
	pnpm test

build:
	pnpm --filter @arlo/desktop build

package:
	pnpm --filter @arlo/desktop package

e2e:
	pnpm --filter @arlo/desktop test:e2e

# Mirrors .github/workflows/ci.yml: install, typecheck, lint, test, package,
# then e2e (macOS-only, matching the CI matrix).
ci: install typecheck lint test package
ifeq ($(shell uname -s),Darwin)
	$(MAKE) e2e
else
	@echo "Skipping e2e (macOS-only in CI, current OS is $(shell uname -s))"
endif

clean:
	rm -rf apps/desktop/out apps/desktop/dist apps/desktop/test-results apps/desktop/playwright-report coverage
