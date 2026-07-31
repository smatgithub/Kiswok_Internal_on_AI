import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /** When true, credentials are already base64 (V2 client parity). Default: plain text. */
  @IsOptional()
  @IsBoolean()
  encoded?: boolean;
}

export class VerifyOtpDto {
  @IsString()
  @MinLength(1)
  empId!: string;

  @IsString()
  @MinLength(4)
  otp!: string;
}

export class ForgotPasswordDto {
  @IsString()
  @MinLength(1)
  empCode!: string;

  @IsString()
  @MinLength(1)
  loginId!: string;
}

export class ResetPasswordDto {
  @IsString()
  empId!: string;

  @IsString()
  loginId!: string;

  @IsString()
  otp!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;

  @IsString()
  @MinLength(6)
  confirmPassword!: string;
}
