VERSION := $(shell cat VERSION)

config ?= release
ifdef config
	ifeq (,$(filter $(config),debug release))
    $(error Unknown configuration "$(config)")
  endif
endif


BUILD_DIR := build/$(config)
DIST_DIR := dist
SRC_DIR := src
EXTENSION_JS := $(DIST_DIR)/extension.js
EXTENSION := $(BUILD_DIR)/pony-$(VERSION).vsix
SOURCE_FILES := $(shell find $(SRC_DIR) -name *.ts)

all: $(EXTENSION)

$(EXTENSION): $(SOURCE_FILES) $(BUILD_DIR) node_modules $(BUILD_DIR)
	npm run vsce package -- --no-git-tag-version --out="$(BUILD_DIR)/pony-$(VERSION).vsix" "$(VERSION)"

node_modules:
	npm install

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

clean:
	rm -rf dist build

.PHONY: clean
