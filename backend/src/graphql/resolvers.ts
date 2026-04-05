import { AppDataSource } from '../data-source';
import { Project } from '../entities/Project';
import { ContextEntry } from '../entities/ContextEntry';
import { Decision } from '../entities/Decision';
import { ApiKey } from '../entities/ApiKey';
import { CryptoUtils } from '../utils/cryptography';

const projectRepository = AppDataSource.getRepository(Project);
const contextEntryRepository = AppDataSource.getRepository(ContextEntry);
const decisionRepository = AppDataSource.getRepository(Decision);
const apiKeyRepository = AppDataSource.getRepository(ApiKey);

export const resolvers = {
  Query: {
    projects: async () => {
      return await projectRepository.find({
        relations: ['contextEntries', 'decisions']
      });
    },

    project: async (_, { id }) => {
      return await projectRepository.findOne({
        where: { id },
        relations: ['contextEntries', 'decisions']
      });
    },

    contextEntries: async (_, { projectId, category }) => {
      const where: any = { project: { id: projectId } };
      if (category) {
        where.category = category;
      }
      
      return await contextEntryRepository.find({
        where,
        relations: ['project'],
        order: { priority: 'DESC', createdAt: 'DESC' }
      });
    },

    decisions: async (_, { projectId }) => {
      return await decisionRepository.find({
        where: { project: { id: projectId } },
        relations: ['project'],
        order: { createdAt: 'DESC' }
      });
    },

    apiKeys: async (_, { projectId }) => {
      return await apiKeyRepository.find({
        where: { project: { id: projectId }, revokedAt: null },
        order: { createdAt: 'DESC' }
      });
    }
  },

  Mutation: {
    createProject: async (_, { name, description }) => {
      const project = projectRepository.create({ name, description });
      return await projectRepository.save(project);
    },

    updateProject: async (_, { id, name, description, status }) => {
      await projectRepository.update(id, { name, description, status });
      return await projectRepository.findOne({
        where: { id },
        relations: ['contextEntries', 'decisions']
      });
    },

    createContextEntry: async (_, { projectId, key, value, category, metadata, priority }) => {
      const project = await projectRepository.findOne({ where: { id: projectId } });
      if (!project) {
        throw new Error('Project not found');
      }

      const contextEntry = contextEntryRepository.create({
        key,
        value,
        category: category || 'general',
        metadata,
        priority: priority || 1,
        project
      });

      return await contextEntryRepository.save(contextEntry);
    },

    updateContextEntry: async (_, { id, key, value, category, metadata, priority }) => {
      await contextEntryRepository.update(id, {
        key,
        value,
        category,
        metadata,
        priority
      });
      
      return await contextEntryRepository.findOne({
        where: { id },
        relations: ['project']
      });
    },

    createDecision: async (_, { projectId, title, description, rationale, alternatives }) => {
      const project = await projectRepository.findOne({ where: { id: projectId } });
      if (!project) {
        throw new Error('Project not found');
      }

      const decision = decisionRepository.create({
        title,
        description,
        rationale,
        alternatives,
        project
      });

      return await decisionRepository.save(decision);
    },

    updateDecision: async (_, { id, title, description, rationale, status, alternatives }) => {
      await decisionRepository.update(id, {
        title,
        description,
        rationale,
        status,
        alternatives
      });
      
      return await decisionRepository.findOne({
        where: { id },
        relations: ['project']
      });
    },

    generateApiKey: async (_, { projectId, name }) => {
      const project = await projectRepository.findOne({ where: { id: projectId } });
      if (!project) {
        throw new Error('Project not found');
      }

      // Generate a new API key
      const plainKey = CryptoUtils.generateApiKey();
      const keyHash = CryptoUtils.hashApiKey(plainKey);

      const apiKey = apiKeyRepository.create({
        name,
        keyHash,
        project
      });

      const saved = await apiKeyRepository.save(apiKey);

      // Return the plain key only on creation (never again)
      return {
        ...saved,
        key: plainKey
      };
    },

    revokeApiKey: async (_, { keyId }) => {
      const apiKey = await apiKeyRepository.findOne({ where: { id: keyId } });
      if (!apiKey) {
        throw new Error('API key not found');
      }

      apiKey.isActive = false;
      apiKey.revokedAt = new Date();
      await apiKeyRepository.save(apiKey);

      return true;
    },

    deleteProject: async (_, { id }) => {
      const project = await projectRepository.findOne({ where: { id } });
      if (!project) {
        throw new Error('Project not found');
      }

      await projectRepository.remove(project);
      return true;
    },

    deleteContextEntry: async (_, { id }) => {
      const entry = await contextEntryRepository.findOne({ where: { id } });
      if (!entry) {
        throw new Error('Context entry not found');
      }

      await contextEntryRepository.remove(entry);
      return true;
    },

    deleteDecision: async (_, { id }) => {
      const decision = await decisionRepository.findOne({ where: { id } });
      if (!decision) {
        throw new Error('Decision not found');
      }

      await decisionRepository.remove(decision);
      return true;
    }
  },

  JSON: {
    serialize: (value) => value,
    parseValue: (value) => value,
    parseLiteral: (ast) => {
      if (ast.kind === 'ObjectValue') {
        return ast.fields.reduce((obj, field) => {
          obj[field.name.value] = field.value.value;
          return obj;
        }, {});
      }
      return null;
    }
  },

  Project: {
    apiKeys: async (project) => {
      return await apiKeyRepository.find({
        where: { project: { id: project.id }, revokedAt: null },
        order: { createdAt: 'DESC' }
      });
    }
  }
};