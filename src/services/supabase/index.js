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
  approveRecommendation,
  checkRatingEligibility,
  getMyRating,
  getRecommendation,
  getRecommendationModerationDetail,
  getRecommendationStats,
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
