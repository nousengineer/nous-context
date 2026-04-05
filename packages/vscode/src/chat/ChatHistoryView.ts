import * as vscode from 'vscode';
import { getPipelineChatHistoryService } from './PipelineChatHistoryService';

export class ChatHistoryView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const historyService = getPipelineChatHistoryService();
    // Use the actual directory to find active chats, not just backups
    const fs = require('fs');
    const path = require('path');
    const historyDir = historyService.getHistoryDirectory();
    
    let pipelineIds: string[] = [];
    
    if (fs.existsSync(historyDir)) {
      const files = fs.readdirSync(historyDir);
      const activeIds = new Set<string>();
      
      files.forEach((f: string) => {
        // Match active pipeline chats
        const matchActive = f.match(/^pipeline-(.*)\.jsonl$/);
        if (matchActive) {
          activeIds.add(matchActive[1]);
        }
        
        // Match backups
        const matchBackup = f.match(/^backup_([^_]+)_/);
        if (matchBackup) {
          activeIds.add(matchBackup[1]);
        }
      });
      
      pipelineIds = Array.from(activeIds);
    }

    if (pipelineIds.length === 0) {
      const emptyItem = new vscode.TreeItem('Nenhum histórico encontrado', vscode.TreeItemCollapsibleState.None);
      return Promise.resolve([emptyItem]);
    }

    const pipelineItems = pipelineIds.map(id => {
      const item = new vscode.TreeItem(`Pipeline: ${id}`, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('history');
      item.description = 'Histórico do Chat';
      item.command = {
        command: 'thinkcoffee.openPipelineChat',
        title: 'Abrir Histórico do Chat',
        arguments: [id],
      };
      // Context value for adding delete/export actions later
      item.contextValue = 'pipelineHistoryItem';
      return item;
    });

    return Promise.resolve(pipelineItems);
  }
}
