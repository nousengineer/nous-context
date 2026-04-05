import * as vscode from 'vscode';

/**
 * Handles asking the user for confirmation before executing potentially destructive commands.
 */
export class CommandConfirmationHandler {
    /**
     * Asks the user for confirmation to run a command.
     * @param command The command that is about to be executed.
     * @param classification The security classification of the command (e.g., 'destructive').
     * @returns A promise that resolves to `true` if the user confirms, `false` otherwise.
     */
    public static async getConfirmation(
        command: string,
        classification: 'destructive' | 'moderate' | 'safe'
    ): Promise<boolean> {
        if (classification !== 'destructive') {
            return true;
        }

        const userResponse = await vscode.window.showWarningMessage(
            `The agent wants to run a potentially destructive command: "${command}". Do you want to allow it?`,
            { modal: true },
            'Allow',
            'Deny'
        );

        return userResponse === 'Allow';
    }
}
