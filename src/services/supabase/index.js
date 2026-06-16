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
  listFeaturedArticles, // @deprecated — 使用 recommendationService 替代
} from './featuredArticles'
export {
  createAuditLog,
  listAuditLogs,
} from './auditLogs'
export {
  addRecommendationToBookshelf,
  checkRatingEligibility,
  checkSubmissionEligibility,
  getMyRating,
  getRecommendation,
  getRecommendationStats,
  listMySubmissions,
  listRecommendations,
  migrateLegacyFeaturedArticles,
  rateRecommendation,
  removeRecommendation,
  submitRecommendation,
  syncAddCountAfterDelete,
  updateRecommendation,
} from './recommendationService'
export {
  getCurrentUser,
  getSession,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  subscribeToAuthStateChange,
} from './auth'
