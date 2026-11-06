import { bindQuotaClasses, type QuotaClassMap } from '../types';
import bodyStyles from './QuotaBody.module.scss';

let bound: QuotaClassMap | null = null;

/**
 * The quota-page body classes, bound on first use rather than at import, so a host that
 * renders a body only after a result arrives can still be imported where CSS Modules
 * are not compiled (the Bun test runner).
 */
export const getQuotaBodyClasses = (): QuotaClassMap =>
  (bound ??= bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss'));
