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
  listAuditLogs,
} from './auditLogs'
export {
  getGrowthStats,
} from './adminStats'
export {
  addRecommendationToBookshelf,
  approveRecommendation,
  getMyRating,
  getRecommendationModerationDetail,
  listMySubmissions,
  listRecommendationModerationQueue,
  listRecommendations,
  publishRecommendation,
  rateRecommendation,
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
