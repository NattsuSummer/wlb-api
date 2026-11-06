export interface TimeCategory {
  id: number;
  nameTh: string;
  nameEn: string;
  color: string; // #RRGGBB (original pastel)
  sort: number;
}

export interface CourseCategory {
  id: number;
  nameTh: string;
  nameEn: string;
  icon: string;
  tint: string;
  sort: number;
}

export interface ApiTokenInfo {
  id: string;
  name: string | null;
  hint: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  owner?: string;
}
