import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email!: string;

  @IsString()
  @MinLength(1, { message: '请输入姓名' })
  @MaxLength(50, { message: '姓名最长 50 个字符' })
  name!: string;

  @IsString()
  @MinLength(6, { message: '密码至少 6 个字符' })
  @MaxLength(100, { message: '密码最长 100 个字符' })
  password!: string;
}

export class LoginDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email!: string;

  @IsString()
  @MinLength(1, { message: '请输入密码' })
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1, { message: 'Refresh token 不能为空' })
  refreshToken!: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: '消息内容不能为空' })
  @MaxLength(10000, { message: '消息内容过长' })
  content!: string;
}

export class CreateFeedbackDto {
  @IsString()
  @IsOptional()
  moduleKey?: string;

  @IsString()
  @IsOptional()
  elementPath?: string;

  @IsString()
  @IsOptional()
  pageUrl?: string;

  @IsString()
  @MinLength(1, { message: '评论内容不能为空' })
  @MaxLength(2000, { message: '评论内容过长' })
  comment!: string;
}

export class UpdateFeedbackStatusDto {
  @IsString()
  @IsOptional()
  status?: string;
}
