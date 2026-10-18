#!/usr/bin/env node
import assert from 'node:assert/strict';
import { verifyMappedAutoplotNegativeFile } from './verify_mapped_autoplot_browser_report.mjs';

const path = process.argv[2];
const fault = process.argv[3];
assert(path && ['failed', 'uncertain'].includes(fault), 'Usage: verify_mapped_autoplot_negative_report.mjs REPORT FAULT');
await verifyMappedAutoplotNegativeFile(path, fault);
console.log(`mapped autoplot negative report (${fault}): verified`);
