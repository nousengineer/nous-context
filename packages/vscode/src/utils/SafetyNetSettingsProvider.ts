import * as vscode from 'vscode';

export class SafetyNetSettingsProvider {
  static getSettings(): { requireConfirmationOnDestructiveAction: boolean } {
    const config = vscode.workspace.getConfiguration('thinkcoffee.safetynet');
    return {
      requireConfirmationOnDestructiveAction: config.get('requireConfirmationOnDestructiveAction', true)
    };
  }
}