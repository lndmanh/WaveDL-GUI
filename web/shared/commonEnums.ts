export enum DeviceType {
  Mobile = 'mobile',
  Tablet = 'tablet',
  Desktop = 'desktop',
}

/**
 * Time in seconds
 */
export enum CACHE_TTL {
  FIFTEEN_MINUTES = 900,
  ONE_HOUR = 3600,
  SIX_HOURS = 21600,
  ONE_DAY = 86400,
  ONE_WEEK = 604800,
  ONE_YEAR = 31536000,
}

export enum AuthTokenType {
  EmailVerification = 'email_verification',
  PasswordReset = 'password_reset',
}

export enum AdminAnalyticsTimeRange {
  Last24Hours = 'last_24h',
  Last3Days = 'last_3d',
  Last7Days = 'last_7d',
  Last30Days = 'last_30d',
}
