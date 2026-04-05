import { gql } from 'graphql-tag';

export const typeDefs = gql`
  type Project {
    id: ID!
    name: String!
    description: String
    status: String!
    metadata: JSON
    contextEntries: [ContextEntry!]!
    decisions: [Decision!]!
    apiKeys: [ApiKey!]!
    createdAt: String!
    updatedAt: String!
  }

  type ContextEntry {
    id: ID!
    key: String!
    value: String!
    category: String!
    metadata: JSON
    priority: Int!
    project: Project!
    createdAt: String!
    updatedAt: String!
  }

  type Decision {
    id: ID!
    title: String!
    description: String!
    rationale: JSON
    status: String!
    alternatives: JSON
    project: Project!
    createdAt: String!
    updatedAt: String!
  }

  type ApiKey {
    id: ID!
    name: String!
    key: String    # Only returned on creation
    isActive: Boolean!
    lastUsed: String
    createdAt: String!
    revokedAt: String
  }

  type Query {
    projects: [Project!]!
    project(id: ID!): Project
    contextEntries(projectId: ID!, category: String): [ContextEntry!]!
    decisions(projectId: ID!): [Decision!]!
    apiKeys(projectId: ID!): [ApiKey!]!
  }

  type Mutation {
    createProject(name: String!, description: String): Project!
    updateProject(id: ID!, name: String, description: String, status: String): Project!
    
    createContextEntry(
      projectId: ID!
      key: String!
      value: String!
      category: String
      metadata: JSON
      priority: Int
    ): ContextEntry!
    
    updateContextEntry(
      id: ID!
      key: String
      value: String
      category: String
      metadata: JSON
      priority: Int
    ): ContextEntry!
    
    createDecision(
      projectId: ID!
      title: String!
      description: String!
      rationale: JSON
      alternatives: JSON
    ): Decision!
    
    updateDecision(
      id: ID!
      title: String
      description: String
      rationale: JSON
      status: String
      alternatives: JSON
    ): Decision!

    generateApiKey(
      projectId: ID!
      name: String!
    ): ApiKey!

    revokeApiKey(
      keyId: ID!
    ): Boolean!

    deleteProject(id: ID!): Boolean!
    deleteContextEntry(id: ID!): Boolean!
    deleteDecision(id: ID!): Boolean!
  }

  scalar JSON
`;