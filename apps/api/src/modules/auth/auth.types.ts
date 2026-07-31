import { AuthUser } from '@kiswok/shared';

/** JWT payload issued by Internal-API (authService.generateToken) */
export interface JwtPayload {
  id?: number;
  username?: string;
  empId?: number;
  locationId?: number | null;
  userName?: string;
  email?: string | null;
  deptId?: number | null;
  dId?: number | null;
  catId?: number | null;
  role?: number | null;
  Phone?: string | null;
  iat?: number;
  exp?: number;
}

export type { AuthUser };

export function userFromJwt(payload: JwtPayload): AuthUser {
  return {
    name: payload.userName || payload.username || '',
    emplId: payload.empId ?? 0,
    loginId: payload.username || '',
    LocationId: payload.locationId ?? null,
    EmpCode: null,
    Email: payload.email ?? null,
    DeptId: payload.deptId ?? null,
    DId: payload.dId ?? null,
    CatId: payload.catId ?? null,
    role: payload.role ?? null,
  };
}
