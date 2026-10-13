import {
  BarChart3, Briefcase, Camera, Code2, Film, Headphones, LayoutTemplate, Mail, Megaphone, Package, Palette, PenLine, PenTool, Search,
  ShoppingBag, Users,
} from 'lucide-react'

/** Department icons. The key is stored on the team; the component is what we draw. */
export const TEAM_ICONS = {
  briefcase: { icon: Briefcase, label: 'Management' },
  palette: { icon: Palette, label: 'Design' },
  camera: { icon: Camera, label: 'Shoot' },
  megaphone: { icon: Megaphone, label: 'Marketing' },
  code: { icon: Code2, label: 'Development' },
  film: { icon: Film, label: 'Video' },
  'pen-tool': { icon: PenTool, label: 'Graphics' },
  'pen-line': { icon: PenLine, label: 'Content' },
  'shopping-bag': { icon: ShoppingBag, label: 'Marketplace' },
  headphones: { icon: Headphones, label: 'Support' },
  'bar-chart': { icon: BarChart3, label: 'Analytics' },
  mail: { icon: Mail, label: 'Email' },
  search: { icon: Search, label: 'SEO' },
  layout: { icon: LayoutTemplate, label: 'Web' },
  package: { icon: Package, label: 'Operations' },
  users: { icon: Users, label: 'General' },
} as const

export type TeamIconKey = keyof typeof TEAM_ICONS

export function TeamIcon({ name, size = 16, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const Icon = TEAM_ICONS[(name ?? 'users') as TeamIconKey]?.icon ?? Users
  return <Icon size={size} className={className} aria-hidden="true" />
}
