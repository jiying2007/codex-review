'use strict';

const vscode = require('vscode');

function t(message, ...args) {
  if (vscode.l10n?.t) return vscode.l10n.t(message, ...args);
  return String(message).replace(/\{(\d+)\}/g, (_match, index) =>
    args[Number(index)] === undefined ? `{${index}}` : String(args[Number(index)])
  );
}

module.exports = { t };
