/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig, mergeConfig } from "vite";
import base, { projectLicense } from "@allurx/js-config/vite";

export default mergeConfig(base, defineConfig({ plugins: [projectLicense()] }));
