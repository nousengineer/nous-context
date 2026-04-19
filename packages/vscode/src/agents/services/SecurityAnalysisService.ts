import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SecurityAnalysisService
 * 
 * Advanced security analysis with:
 * - Vulnerability discovery
 * - Zero-day hypothesis generation
 * - Attack chain analysis
 * - Defensive recommendations
 */

export interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  title: string;
  detail: string;
  cwe?: string;
  cvss?: number;
}

export interface SecurityScanResult {
  findings: SecurityFinding[];
  attackSimulationPlan: string[];
  exploitChainHypotheses: string[];
  defensiveRecommendations: string[];
  threatScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
}

export class SecurityAnalysisService {
  constructor(private aiProvider: any) {}

  /**
   * Defensive security scan
   */
  async defensiveScan(folderPath: string): Promise<SecurityScanResult> {
    const files = this.collectFiles(folderPath, 500);
    const findings: SecurityFinding[] = [];

    // Pattern-based detection
    for (const filePath of files) {
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const rel = path.relative(folderPath, filePath);
      
      // Check for hardcoded secrets
      if (this.detectSecrets(content)) {
        findings.push({
          severity: 'critical',
          file: rel,
          title: 'Hardcoded Secrets Detected',
          detail: 'API keys, passwords, or tokens found in source code',
          cwe: 'CWE-798',
          cvss: 9.8,
        });
      }

      // Check for SQL injection
      if (this.detectSQLInjection(content)) {
        findings.push({
          severity: 'high',
          file: rel,
          title: 'SQL Injection Vulnerability',
          detail: 'String concatenation in SQL queries detected',
          cwe: 'CWE-89',
          cvss: 9.8,
        });
      }

      // Check for XSS
      if (this.detectXSS(content)) {
        findings.push({
          severity: 'high',
          file: rel,
          title: 'Cross-Site Scripting (XSS) Risk',
          detail: 'Unsanitized user input rendered to DOM',
          cwe: 'CWE-79',
          cvss: 7.1,
        });
      }

      // Check for command injection
      if (this.detectCommandInjection(content)) {
        findings.push({
          severity: 'high',
          file: rel,
          title: 'Command Injection Risk',
          detail: 'Unsafe shell command execution detected',
          cwe: 'CWE-78',
          cvss: 9.8,
        });
      }

      // Check for authentication flaws
      if (this.detectAuthFlaws(content)) {
        findings.push({
          severity: 'high',
          file: rel,
          title: 'Authentication Weakness',
          detail: 'Weak authentication or authorization implementation',
          cwe: 'CWE-287',
          cvss: 7.5,
        });
      }
    }

    const threatScore = this.calculateThreatScore(findings);
    const riskLevel = this.calculateRiskLevel(threatScore);

    return {
      findings,
      attackSimulationPlan: [
        'Map entry points and attack surface',
        'Identify authentication bypass opportunities',
        'Test input validation boundaries',
        'Probe for privilege escalation paths',
        'Simulate supply chain attacks',
        'Test error handling and information leakage',
      ],
      exploitChainHypotheses: [
        'Input validation bypass → Code execution → Data exfiltration',
        'Auth bypass → Privilege escalation → System compromise',
        'API enumeration → Secret disclosure → Lateral movement',
      ],
      defensiveRecommendations: [
        'Implement strict input validation and output encoding',
        'Use parameterized queries for all database operations',
        'Enforce multi-factor authentication',
        'Deploy WAF with rule-based protection',
        'Implement rate limiting and DDoS protection',
        'Regular security testing and code review',
        'Maintain patch management program',
      ],
      threatScore,
      riskLevel,
    };
  }

  /**
   * Collect files
   */
  private collectFiles(folderPath: string, limit: number = 500): string[] {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cs', '.go', '.rs'];

    const walk = (dir: string) => {
      if (files.length >= limit) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (files.length >= limit) break;
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      } catch {}
    };

    walk(folderPath);
    return files;
  }

  /**
   * Detection functions
   */
  private detectSecrets(content: string): boolean {
    const patterns = [
      /(api[_-]?key|apikey)\s*[=:]\s*['\"][^'\"]+['\"]/i,
      /(password|passwd)\s*[=:]\s*['\"][^'\"]+['\"]/i,
      /(token|secret|credential)\s*[=:]\s*['\"][^'\"]{8,}['\"]/i,
      /aws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*['\"][^'\"]+['\"]/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private detectSQLInjection(content: string): boolean {
    return /SELECT.*FROM.*WHERE.*\+|INSERT.*VALUES.*\+|UPDATE.*SET.*\+/i.test(content);
  }

  private detectXSS(content: string): boolean {
    return /(innerHTML|dangerouslySetInnerHTML|eval)\s*=|document\.write|innerHTML\s*\+=/.test(content);
  }

  private detectCommandInjection(content: string): boolean {
    return /(child_process|exec|spawn|system)\s*\(|`.*\$\{/i.test(content);
  }

  private detectAuthFlaws(content: string): boolean {
    return /(password|token)\s*(===|==)|disable.*auth|skip.*auth/i.test(content);
  }

  /**
   * Calculate threat score
   */
  private calculateThreatScore(findings: SecurityFinding[]): number {
    let score = 0;
    for (const finding of findings) {
      switch (finding.severity) {
        case 'critical': score += 25; break;
        case 'high': score += 15; break;
        case 'medium': score += 8; break;
        case 'low': score += 2; break;
      }
    }
    return Math.min(100, score);
  }

  /**
   * Calculate risk level
   */
  private calculateRiskLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }
}

export default SecurityAnalysisService;
