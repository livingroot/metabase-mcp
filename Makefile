IMAGE    ?= livingroot/metabase-mcp
VERSION  ?= $(shell node -p "require('./package.json').version")
PLATFORM ?= linux/amd64,linux/arm64

.PHONY: build push publish

publish:
	docker buildx build \
		--platform $(PLATFORM) \
		--tag $(IMAGE):$(VERSION) \
		--tag $(IMAGE):latest \
		--push \
		.