'use strict';
/**
 * Builds a "site_id IN (...)" scope clause from getAllowedSiteIds() output.
 * null  -> super admin, no restriction
 * []    -> returns null: the user can see nothing (caller returns an empty result)
 */
exports.scopeClause = (allowedSiteIds, column = 'l.site_id') => {
  if (allowedSiteIds === null) return { sql: '1=1', params: [] };
  if (!allowedSiteIds.length) return null;
  return { sql: `${column} IN (${allowedSiteIds.map(() => '?').join(',')})`, params: [...allowedSiteIds] };
};
