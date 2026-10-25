import { useEffect } from 'react'
import { CheckCircle2, CircleAlert, Info, LoaderCircle, X, XCircle } from 'lucide-react'

export function Badge({ children, tone = 'slate', dot = false }) {
  const tones = { green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10', blue: 'bg-blue-50 text-blue-700 ring-blue-600/10', amber: 'bg-amber-50 text-amber-700 ring-amber-600/10', red: 'bg-rose-50 text-rose-700 ring-rose-600/10', slate: 'bg-slate-100 text-slate-600 ring-slate-500/10', violet: 'bg-violet-50 text-violet-700 ring-violet-600/10' }
  const dotColors = { green: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500', red: 'bg-rose-500', slate: 'bg-slate-400', violet: 'bg-violet-500' }
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${tones[tone] || tones.slate}`}>{dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColors[tone] || dotColors.slate}`} />}{children}</span>
}

export function Avatar({ person, size = 'md' }) {
  const sizes = size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-10 w-10 text-xs'
  const colors = { violet: 'bg-violet-100 text-violet-700', blue: 'bg-blue-100 text-blue-700', rose: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-700', teal: 'bg-teal-100 text-teal-700', indigo: 'bg-indigo-100 text-indigo-700' }
  return <span className={`${sizes} ${colors[person.color] || 'bg-slate-100 text-slate-700'} inline-flex shrink-0 items-center justify-center rounded-full font-semibold`}>{person.initials}</span>
}

export function PageHeading({ eyebrow, title, description, action }) { return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1.5 text-xs font-semibold uppercase tracking-[.13em] text-slate-400">{eyebrow}</p><h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">{title}</h1>{description && <p className="mt-1.5 text-sm text-slate-500">{description}</p>}</div>{action}</div> }

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const variants = { primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700', secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50', ghost: 'text-slate-600 hover:bg-slate-100', danger: 'bg-rose-600 text-white hover:bg-rose-700' }
  return <button className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`} {...props}>{children}</button>
}

export function Card({ children, className = '' }) { return <section className={`rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[.025] ${className}`}>{children}</section> }
export function EmptyState({ icon: Icon = Info, title, text, action }) { return <div className="flex flex-col items-center justify-center px-6 py-12 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Icon size={21} /></span><h3 className="font-semibold text-slate-800">{title}</h3><p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>{action && <div className="mt-4">{action}</div>}</div> }
export function ErrorMessage({ children, onRetry }) { return <div className="flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><span className="flex items-center gap-2"><CircleAlert size={17} />{children}</span>{onRetry && <button onClick={onRetry} className="font-semibold underline">Retry</button>}</div> }
export function LoadingState({ label = 'Loading…' }) { return <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle size={18} className="animate-spin" />{label}</div> }

export function Modal({ open, title, onClose, children, wide = false }) {
  useEffect(() => { if (!open) return; const close = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', close); document.body.style.overflow = 'hidden'; return () => { window.removeEventListener('keydown', close); document.body.style.overflow = '' } }, [open, onClose])
  if (!open) return null
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`} role="dialog" aria-modal="true" aria-label={title}><div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4"><h2 className="font-semibold text-slate-900">{title}</h2><button aria-label="Close dialog" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><div className="p-5">{children}</div></div></div>
}

export function Toast({ toast, onClose }) {
  useEffect(() => { if (!toast) return; const t = setTimeout(onClose, 3500); return () => clearTimeout(t) }, [toast, onClose])
  if (!toast) return null
  const Icon = toast.type === 'error' ? XCircle : CheckCircle2
  return <div role="status" className={`fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${toast.type === 'error' ? 'border-rose-200 bg-white text-rose-700' : 'border-emerald-200 bg-white text-emerald-700'}`}><Icon size={19} className="mt-0.5 shrink-0" /><span className="text-sm font-medium">{toast.message}</span><button onClick={onClose} className="ml-2 text-slate-400"><X size={16} /></button></div>
}

export const statusTone = (status) => ({ Active: 'green', Paused: 'amber', New: 'blue', Reviewing: 'violet', Shortlisted: 'green', Rejected: 'red', Hired: 'green' }[status] || 'slate')
