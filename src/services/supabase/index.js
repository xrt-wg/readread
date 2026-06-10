export {
  assertSupabaseConfigured,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client'
export {
  ensureProfile,
  isCurrentUserAdmin,
  listAdminProfiles,
  markInitialMigrationCompleted,
} from './profile'
export {
  listFeaturedArticles,
} from './featuredArticles'
export {
  createAuditLog,
  listAuditLogs,
} from './auditLogs'
export {
  getCurrentUser,
  getSession,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  subscribeToAuthStateChange,
} from './auth'
