import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Handles showing a diff preview to the user for file modifications.
 */
export class DiffPreviewHandler {
    /**
     * Shows a diff view to the user and asks for confirmation.
     * @param workspaceRoot The root of the current workspace.
     * @param relativePath The relative path of the file being modified.
     * @param newContent The proposed new content for the file.
     * @returns A promise that resolves to `true` if the user accepts the change, `false` otherwise.
     */
    public static async showDiff(
        workspaceRoot: string,
        relativePath: string,
        newContent: string
    ): Promise<boolean> {
        const absolutePath = path.join(workspaceRoot, relativePath);
        let originalContent = '';

        try {
            originalContent = await fs.readFile(absolutePath, 'utf-8');
        } catch (error) {
            // If the file doesn't exist, treat original content as empty.
            // This might happen if the agent intends to create a file but uses a write action.
            originalContent = '';
        }

        const tempDir = path.join(os.tmpdir(), 'thinkcoffee-diff');
        await fs.mkdir(tempDir, { recursive: true });

        const originalFileUri = vscode.Uri.file(path.join(tempDir, `original-${path.basename(relativePath)}`));
        const modifiedFileUri = vscode.Uri.file(path.join(tempDir, `modified-${path.basename(relativePath)}`));

        await fs.writeFile(originalFileUri.fsPath, originalContent);
        await fs.writeFile(modifiedFileUri.fsPath, newContent);

        const originalDocName = `${relativePath} (Original)`;
        const modifiedDocName = `${relativePath} (Proposed)`;

        await vscode.commands.executeCommand(
            'vscode.diff',
            originalFileUri,
            modifiedFileUri,
            `${originalDocName} ↔ ${modifiedDocName}`
        );

        const userResponse = await vscode.window.showWarningMessage(
            `Apply changes to ${relativePath}?`,
            { modal: true },
            'Apply',
            'Discard'
        );

        // Clean up temporary files
        await fs.unlink(originalFileUri.fsPath).catch(() => {});
        await fs.unlink(modifiedFileUri.fsPath).catch(() => {});

        return userResponse === 'Apply';
    }
}
