export {
  assertSupabaseConfigured,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client'
export {
  ensureProfile,
  isCurrentUserAdmin,
  listAdminProfiles,
} from './profile'
export {
  createAuditLog,
  listAuditLogs,
} from './auditLogs'
export {
  addRecommendationToBookshelf,
  approveRecommendation,
  getRecommendation,
  getRecommendationModerationDetail,
  getRecommendationStats,
  listMySubmissions,
  listRecommendationModerationQueue,
  listRecommendations,
  publishRecommendation,
  rejectRecommendation,
  removePublishedRecommendation,
  listSubmittableReadings,
  submitRecommendationForReview,
  syncAddCountAfterDelete,
  updateRecommendationEditorial,
} from './recommendationService'
export {
  getCurrentUser,
  getSession,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  subscribeToAuthStateChange,
} from './auth'
