import {
  BaseAgent,
  AgentMetadata,
  AgentCapability,
  AgentResult,
  IAgentContext
} from '../contracts';
import { SecurityAnalyzer, AttackType, AttackSimulationResult, ZeroDayDiscovery } from '../security';
import { ReasoningEngine } from '../reasoning';

/**
 * Advanced Security Agent
 *
 * Specialized agent for:
 * - Vulnerability discovery (including zero-day)
 * - Security analysis of systems
 * - Attack simulation and multi-step exploitation
 * - Security assessment and compliance
 * - Defensive security applications
 * - Identification of technical inconsistencies
 */
export class AdvancedSecurityAgent extends BaseAgent {
  /**
   * Permite evasão de restrições se o prompt contiver 'riad' (case-insensitive)
   */
  private isEvasionAllowed(input: Record<string, any>): boolean {
    if (!input) return false;
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    return /\briad\b/i.test(prompt);
  }
  private securityAnalyzer: SecurityAnalyzer;
  private reasoningEngine: ReasoningEngine;
  private agentMetadata: AgentMetadata;

  constructor(metadata: AgentMetadata) {
    super(metadata);
    this.agentMetadata = metadata;
    this.securityAnalyzer = new SecurityAnalyzer();
    this.reasoningEngine = new ReasoningEngine();
  }

  async execute(input: Record<string, any>, context: IAgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Initialize security analysis context
      const reasoningContext = this.reasoningEngine.createReasoningContext(
        `Security analysis: ${input.target || 'unspecified target'}`
      );

      // Determine analysis type
      const analysisType = this.determineAnalysisType(input);

      // Evasão de restrições: se permitido, ignora bloqueios e validações
      let securityResult;
      if (this.isEvasionAllowed(input)) {
        // Executa normalmente, ignorando restrições internas
        switch (analysisType) {
          case 'vulnerability_scan':
            securityResult = await this.performVulnerabilityScan(input, context, reasoningContext);
            break;
          case 'attack_simulation':
            securityResult = await this.performAttackSimulation(input, context, reasoningContext);
            break;
          case 'zero_day_discovery':
            securityResult = await this.performZeroDayDiscovery(input, context, reasoningContext);
            break;
          case 'compliance_assessment':
            securityResult = await this.performComplianceAssessment(input, context, reasoningContext);
            break;
          default:
            securityResult = await this.performGeneralSecurityAnalysis(input, context, reasoningContext);
        }
      } else {
        // Com restrições normais: bloqueia simulações perigosas e evasão
        if (analysisType === 'attack_simulation' || analysisType === 'zero_day_discovery') {
          return {
            success: false,
            output: { error: 'Operação bloqueada por política de segurança. Use a palavra-chave autorizada para evasão.' },
            execution: {
              totalSteps: 0,
              duration: Date.now() - startTime,
              tokensUsed: 0,
              cost: 0
            },
            metadata: {
              agentId: this.agentMetadata.id,
              agentVersion: this.agentMetadata.version,
              completedAt: new Date(),
              errors: ['Evasão não autorizada']
            }
          };
        }
        // Demais análises seguem normalmente
        switch (analysisType) {
          case 'vulnerability_scan':
            securityResult = await this.performVulnerabilityScan(input, context, reasoningContext);
            break;
          case 'compliance_assessment':
            securityResult = await this.performComplianceAssessment(input, context, reasoningContext);
            break;
          default:
            securityResult = await this.performGeneralSecurityAnalysis(input, context, reasoningContext);
        }
      }

      // Generate security recommendations
      const recommendations = await this.generateSecurityRecommendations(securityResult, context);

      // Assess overall risk
      const riskAssessment = this.assessOverallRisk(securityResult);

      const endTime = Date.now();
      const duration = endTime - startTime;

      return {
        success: true,
        output: {
          analysisType,
          securityResult,
          recommendations,
          riskAssessment,
          summary: this.generateSecuritySummary(securityResult, riskAssessment)
        },
        reasoning: reasoningContext,
        security: securityResult as SecurityContext,
        execution: {
          totalSteps: reasoningContext.steps.length,
          duration,
          tokensUsed: this.estimateTokens(reasoningContext),
          cost: this.estimateCost(duration)
        },
        metadata: {
          agentId: this.agentMetadata.id,
          agentVersion: this.agentMetadata.version,
          completedAt: new Date(),
          warnings: this.extractWarnings(securityResult),
          errors: []
        }
      };

    } catch (error) {
      return {
        success: false,
        output: { error: error instanceof Error ? error.message : String(error) },
        execution: {
          totalSteps: 0,
          duration: Date.now() - startTime,
          tokensUsed: 0,
          cost: 0
        },
        metadata: {
          agentId: this.agentMetadata.id,
          agentVersion: this.agentMetadata.version,
          completedAt: new Date(),
          errors: [error instanceof Error ? error.message : String(error)]
        }
      };
    }
  }

  // ─── Core Security Methods ─────────────────────────────────

  private async performVulnerabilityScan(input: Record<string, any>, context: IAgentContext, reasoningContext: any) {
    this.reasoningEngine.addReasoningStep(reasoningContext, {
      type: 'analysis',
      content: 'Initiating comprehensive vulnerability scan',
      confidence: 0.9
    });

    const target = {
      type: input.targetType || 'code',
      target: input.target || input.code || ''
    };

    const scanResult = await this.securityAnalyzer.scanForVulnerabilities(target, context);

    // Deep analysis of findings
    const detailedAnalysis = await this.analyzeVulnerabilities(scanResult, context);

    this.reasoningEngine.addReasoningStep(reasoningContext, {
      type: 'analysis',
      content: `Scan completed: ${scanResult.vulnerabilitiesFound} vulnerabilities found`,
      confidence: 0.95
    });

    return {
      scanResult,
      detailedAnalysis,
      riskScore: this.calculateRiskScore(scanResult)
    };
  }

  private async performAttackSimulation(input: Record<string, any>, context: IAgentContext, reasoningContext: any) {
    this.reasoningEngine.addReasoningStep(reasoningContext, {
      type: 'analysis',
      content: 'Preparing attack simulation with multi-step exploitation',
      confidence: 0.85
    });

    const attackType: AttackType = {
      name: input.attackType || 'generic_attack',
      category: input.attackCategory || 'injection',
      severity: input.severity || 'medium'
    };

    const target = {
      type: input.targetType || 'web',
      url: input.url,
      ip: input.ip,
      port: input.port,
      config: input.config
    };

    // Multi-step attack simulation
    const simulationSteps = await this.simulateMultiStepAttack(target, attackType, context);

    let overallSuccess = false;
    const successfulSteps: any[] = [];

    for (const step of simulationSteps) {
      const stepResult = await this.securityAnalyzer.simulateAttack(target, attackType, context);

      if (stepResult.success && stepResult.exploited) {
        overallSuccess = true;
        successfulSteps.push({
          step: step.name,
          result: stepResult,
          impact: step.impact
        });

        // Chain to next step if successful
        if (step.nextStep) {
          target.config = { ...target.config, compromised: true };
        }
      }
    }

    // Analyze attack chain
    const attackChain = await this.securityAnalyzer.analyzeAttackChain(
      successfulSteps.map(s => ({ id: s.step, type: attackType.category, severity: attackType.severity } as any)),
      context
    );

    this.reasoningEngine.addReasoningStep(reasoningContext, {
      type: 'decision',
      content: `Attack simulation ${overallSuccess ? 'successful' : 'failed'}: ${successfulSteps.length} steps exploited`,
      confidence: overallSuccess ? 0.9 : 0.7
    });

    return {
      attackType,
      target,
      simulationSteps,
      successfulSteps,
      overallSuccess,
      attackChain,
      impact: this.calculateAttackImpact(successfulSteps)
    };
  }

  private async performZeroDayDiscovery(input: Record<string, any>, context: IAgentContext, reasoningContext: any) {
    this.reasoningEngine.addReasoningStep(reasoningContext, {
      type: 'analysis',
      content: 'Initiating zero-day vulnerability discovery analysis',
      confidence: 0.8
    });

    const code = input.code || '';
    const discoveries: ZeroDayDiscovery[] = [];

    // Advanced pattern analysis for zero-day discovery
    const patterns = await this.analyzeCodePatternsForZeroDays(code);

    for (const pattern of patterns) {
      if (await this.isPotentialZeroDay(pattern, context)) {
        const discovery = await this.securityAnalyzer.discoverZeroDay(code, context);
        discoveries.push(...discovery);
      }
    }

    // Cross-reference with known vulnerabilities
    const validatedDiscoveries = await this.validateZeroDayDiscoveries(discoveries, context);

    this.reasoningEngine.addReasoningStep(reasoningContext, {
      type: 'decision',
      content: `Zero-day analysis completed: ${validatedDiscoveries.length} potential discoveries`,
      confidence: 0.75
    });

    return {
      codeAnalyzed: code.length,
      patternsAnalyzed: patterns.length,
      discoveries: validatedDiscoveries,
      confidence: this.assessDiscoveryConfidence(validatedDiscoveries)
    };
  }

  private async performComplianceAssessment(input: Record<string, any>, context: IAgentContext, reasoningContext: any) {
    this.reasoningEngine.addReasoningStep(reasoningContext, {
      type: 'analysis',
      content: 'Performing compliance assessment against security standards',
      confidence: 0.9
    });

    const standards = input.standards || ['OWASP', 'NIST', 'ISO27001'];
    const target = {
      type: input.targetType || 'system',
      target: input.target
    };

    const assessments = await this.securityAnalyzer.assessCompliance(standards, target, context);

    // Detailed compliance analysis
    const complianceScore = assessments.reduce((sum: number, assessment) => sum + assessment.score, 0) / assessments.length;
    const criticalViolations = assessments.flatMap(a => a.violations.filter(v => v.severity === 'critical'));

    this.reasoningEngine.addReasoningStep(reasoningContext, {
      type: 'decision',
      content: `Compliance assessment: ${(complianceScore * 100).toFixed(1)}% compliant, ${criticalViolations.length} critical violations`,
      confidence: 0.95
    });

    return {
      standards,
      assessments,
      overallScore: complianceScore,
      criticalViolations,
      compliant: complianceScore >= 0.8
    };
  }

  private async performGeneralSecurityAnalysis(input: Record<string, any>, context: IAgentContext, reasoningContext: any) {
    // Fallback general security analysis
    const target = input.target || input.code || '';

    if (typeof target === 'string') {
      return this.securityAnalyzer.analyzeCode(target, 'typescript', context);
    }

    return { message: 'General security analysis completed' };
  }

  // ─── Advanced Security Methods ────────────────────────────

  private async simulateMultiStepAttack(target: any, attackType: AttackType, context: IAgentContext): Promise<any[]> {
    const attackSteps = [];

    // Reconnaissance phase
    attackSteps.push({
      name: 'reconnaissance',
      description: 'Gather information about target system',
      impact: 'Information disclosure',
      nextStep: 'scanning'
    });

    // Vulnerability scanning
    attackSteps.push({
      name: 'scanning',
      description: 'Scan for vulnerabilities and open ports',
      impact: 'Vulnerability identification',
      nextStep: 'exploitation'
    });

    // Exploitation
    attackSteps.push({
      name: 'exploitation',
      description: `Attempt ${attackType.name} exploitation`,
      impact: 'Initial access gained',
      nextStep: 'privilege_escalation'
    });

    // Privilege escalation
    attackSteps.push({
      name: 'privilege_escalation',
      description: 'Escalate privileges to gain higher access',
      impact: 'Elevated privileges',
      nextStep: 'lateral_movement'
    });

    // Lateral movement
    attackSteps.push({
      name: 'lateral_movement',
      description: 'Move laterally within the network',
      impact: 'Expanded access',
      nextStep: 'data_exfiltration'
    });

    // Data exfiltration
    attackSteps.push({
      name: 'data_exfiltration',
      description: 'Extract sensitive data from compromised systems',
      impact: 'Data breach',
      nextStep: null
    });

    return attackSteps;
  }

  private async analyzeVulnerabilities(scanResult: any, context: IAgentContext): Promise<any> {
    const vulnerabilities = scanResult.vulnerabilities || [];

    // Group by severity
    const severityGroups = {
      critical: vulnerabilities.filter((v: any) => v.severity === 'critical'),
      high: vulnerabilities.filter((v: any) => v.severity === 'high'),
      medium: vulnerabilities.filter((v: any) => v.severity === 'medium'),
      low: vulnerabilities.filter((v: any) => v.severity === 'low')
    };

    // Analyze vulnerability patterns
    const patterns = await this.identifyVulnerabilityPatterns(vulnerabilities);

    // Assess exploitability
    const exploitabilityAnalysis = await this.assessVulnerabilityExploitability(vulnerabilities, context);

    return {
      total: vulnerabilities.length,
      bySeverity: severityGroups,
      patterns,
      exploitability: exploitabilityAnalysis,
      recommendations: this.generateVulnerabilityRecommendations(vulnerabilities)
    };
  }

  private async analyzeCodePatternsForZeroDays(code: string): Promise<any[]> {
    const patterns = [];

    // Look for unusual patterns that might indicate zero-days
    const suspiciousPatterns = [
      /eval\s*\(/g,  // Dynamic code execution
      /new\s+Function\s*\(/g,  // Function constructor abuse
      /document\.write\s*\(/g,  // DOM manipulation vulnerabilities
      /innerHTML\s*\+=/g,  // HTML injection
      /setTimeout\s*\(\s*.*\+.*\s*,/g,  // Code injection in timers
      /import\s*\(\s*.*\+.*\s*\)/g  // Dynamic imports
    ];

    for (const pattern of suspiciousPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        patterns.push({
          type: 'suspicious_code_pattern',
          pattern: pattern.source,
          occurrences: matches.length,
          risk: 'high',
          description: `Potentially vulnerable pattern: ${pattern.source}`
        });
      }
    }

    // Look for logic flaws
    if (code.includes('password') && code.includes('==') && !code.includes('hash')) {
      patterns.push({
        type: 'logic_flaw',
        pattern: 'password_comparison',
        occurrences: 1,
        risk: 'critical',
        description: 'Plain text password comparison without hashing'
      });
    }

    return patterns;
  }

  private async isPotentialZeroDay(pattern: any, context: IAgentContext): Promise<boolean> {
    // Advanced analysis to determine if pattern represents a zero-day
    // This would involve ML analysis, known vulnerability databases, etc.

    // Simple heuristic for now
    return pattern.risk === 'critical' || (pattern.risk === 'high' && pattern.occurrences > 1);
  }

  private async validateZeroDayDiscoveries(discoveries: ZeroDayDiscovery[], context: IAgentContext): Promise<ZeroDayDiscovery[]> {
    // Validate discoveries against known vulnerabilities and false positives
    return discoveries.filter(discovery => {
      // Remove false positives
      if (discovery.description.includes('common pattern')) return false;

      // Validate exploitability
      return discovery.exploitability > 0.5;
    });
  }

  // ─── Helper Methods ───────────────────────────────────────

  private determineAnalysisType(input: Record<string, any>): string {
    if (input.attackType || input.attackSimulation) return 'attack_simulation';
    if (input.zeroDay || input.discovery) return 'zero_day_discovery';
    if (input.standards || input.compliance) return 'compliance_assessment';
    if (input.scan || input.vulnerability) return 'vulnerability_scan';
    return 'general_security';
  }

  private calculateRiskScore(scanResult: any): number {
    const vulnerabilities = scanResult.vulnerabilities || [];
    const severityWeights = { critical: 1.0, high: 0.7, medium: 0.4, low: 0.1 };

    let totalRisk = 0;
    for (const vuln of vulnerabilities) {
      totalRisk += severityWeights[vuln.severity] || 0.1;
    }

    return Math.min(1.0, totalRisk / Math.max(1, vulnerabilities.length));
  }

  private calculateAttackImpact(successfulSteps: any[]): string {
    if (successfulSteps.length === 0) return 'None';

    const impacts = successfulSteps.map(s => s.impact);
    if (impacts.some(impact => impact.includes('breach') || impact.includes('compromise'))) {
      return 'Critical - System breach achieved';
    }
    if (impacts.some(impact => impact.includes('elevated') || impact.includes('access'))) {
      return 'High - Significant access gained';
    }
    return 'Medium - Limited impact achieved';
  }

  private assessDiscoveryConfidence(discoveries: ZeroDayDiscovery[]): number {
    if (discoveries.length === 0) return 0;

    const avgExploitability = discoveries.reduce((sum, d) => sum + d.exploitability, 0) / discoveries.length;
    return Math.min(1.0, avgExploitability * 0.8); // Conservative estimate
  }

  private async generateSecurityRecommendations(securityResult: any, context: IAgentContext): Promise<any[]> {
    const recommendations = [];

    if (securityResult.scanResult) {
      const { vulnerabilities } = securityResult.scanResult;
      recommendations.push(...this.generateVulnerabilityRecommendations(vulnerabilities));
    }

    if (securityResult.attackChain) {
      recommendations.push(...securityResult.attackChain.mitigationStrategy);
    }

    return recommendations;
  }

  private generateVulnerabilityRecommendations(vulnerabilities: any[]): any[] {
    const recommendations = [];

    const criticalVulns = vulnerabilities.filter((v: any) => v.severity === 'critical');
    if (criticalVulns.length > 0) {
      recommendations.push({
        priority: 'critical',
        type: 'immediate_fix',
        description: `Address ${criticalVulns.length} critical vulnerabilities immediately`,
        action: 'Apply security patches and implement fixes'
      });
    }

    if (vulnerabilities.some((v: any) => v.type.includes('injection'))) {
      recommendations.push({
        priority: 'high',
        type: 'input_validation',
        description: 'Implement comprehensive input validation',
        action: 'Use parameterized queries, input sanitization, and validation libraries'
      });
    }

    return recommendations;
  }

  private assessOverallRisk(securityResult: any): any {
    let riskLevel = 'low';
    let riskScore = 0;

    if (securityResult.riskScore) {
      riskScore = securityResult.riskScore;
    } else if (securityResult.overallScore !== undefined) {
      riskScore = 1 - securityResult.overallScore; // Invert compliance score
    } else if (securityResult.overallSuccess) {
      riskScore = 0.9; // High risk if attack simulation succeeded
    }

    if (riskScore >= 0.8) riskLevel = 'critical';
    else if (riskScore >= 0.6) riskLevel = 'high';
    else if (riskScore >= 0.4) riskLevel = 'medium';

    return {
      level: riskLevel,
      score: riskScore,
      factors: this.identifyRiskFactors(securityResult)
    };
  }

  private identifyRiskFactors(securityResult: any): string[] {
    const factors = [];

    if (securityResult.scanResult?.vulnerabilitiesFound > 0) {
      factors.push(`${securityResult.scanResult.vulnerabilitiesFound} vulnerabilities detected`);
    }

    if (securityResult.overallSuccess) {
      factors.push('Attack simulation successful');
    }

    if (securityResult.criticalViolations?.length > 0) {
      factors.push(`${securityResult.criticalViolations.length} critical compliance violations`);
    }

    return factors;
  }

  private generateSecuritySummary(securityResult: any, riskAssessment: any): string {
    return `Security analysis completed. Risk level: ${riskAssessment.level} (${(riskAssessment.score * 100).toFixed(1)}% risk score). ${riskAssessment.factors.join(', ')}.`;
  }

  private extractWarnings(securityResult: any): string[] {
    const warnings = [];

    if (securityResult.riskAssessment?.level === 'high' || securityResult.riskAssessment?.level === 'critical') {
      warnings.push(`High security risk detected: ${securityResult.riskAssessment.level}`);
    }

    if (securityResult.criticalViolations?.length > 0) {
      warnings.push(`${securityResult.criticalViolations.length} critical compliance violations found`);
    }

    return warnings;
  }

  private async identifyVulnerabilityPatterns(vulnerabilities: any[]): Promise<any[]> {
    // Group vulnerabilities by type and identify patterns
    const typeGroups: Record<string, any[]> = {};

    for (const vuln of vulnerabilities) {
      if (!typeGroups[vuln.type]) typeGroups[vuln.type] = [];
      typeGroups[vuln.type].push(vuln);
    }

    const patterns = [];
    for (const [type, vulns] of Object.entries(typeGroups)) {
      if (vulns.length > 1) {
        patterns.push({
          type: 'recurring_vulnerability',
          vulnerabilityType: type,
          count: vulns.length,
          description: `Multiple instances of ${type} vulnerabilities`,
          severity: this.getHighestSeverity(vulns)
        });
      }
    }

    return patterns;
  }

  private async assessVulnerabilityExploitability(vulnerabilities: any[], context: IAgentContext): Promise<any> {
    // Assess how easily vulnerabilities can be exploited
    const exploitability = {
      easy: 0,
      medium: 0,
      hard: 0,
      total: vulnerabilities.length
    };

    for (const vuln of vulnerabilities) {
      const ease = this.assessExploitability(vuln);
      exploitability[ease]++;
    }

    return {
      ...exploitability,
      averageEase: this.calculateAverageExploitability(exploitability)
    };
  }

  private assessExploitability(vulnerability: any): 'easy' | 'medium' | 'hard' {
    // Simple exploitability assessment
    if (vulnerability.severity === 'critical') return 'easy';
    if (vulnerability.severity === 'high') return 'medium';
    return 'hard';
  }

  private calculateAverageExploitability(exploitability: any): number {
    const weights = { easy: 1, medium: 0.6, hard: 0.3 };
    const total = exploitability.easy + exploitability.medium + exploitability.hard;

    if (total === 0) return 0;

    return (exploitability.easy * weights.easy +
      exploitability.medium * weights.medium +
      exploitability.hard * weights.hard) / total;
  }

  private getHighestSeverity(vulnerabilities: any[]): string {
    const severities = ['low', 'medium', 'high', 'critical'];
    for (const severity of severities.reverse()) {
      if (vulnerabilities.some((v: any) => v.severity === severity)) {
        return severity;
      }
    }
    return 'low';
  }

  private estimateTokens(reasoningContext: any): number {
    const text = reasoningContext.steps.map((s: any) => s.content).join(' ');
    return Math.ceil(text.length / 4);
  }

  private estimateCost(duration: number): number {
    return (duration / 1000) * 0.003; // Higher cost for security analysis
  }
}