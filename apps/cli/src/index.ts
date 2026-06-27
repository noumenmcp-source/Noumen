#!/usr/bin/env node
import { runCli } from "./app.js";

void runCli({ argv: process.argv.slice(2) }).then((code) => {
  process.exitCode = code;
});
