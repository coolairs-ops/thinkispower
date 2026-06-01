import { IsString, IsOptional, MaxLength } from 'class-validator';

export class DiscoveryNextDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: '回答内容过长' })
  answer?: string;
}

export class DiscoveryEnrichDto {
  @IsString()
  field!: string;

  @IsOptional()
  value?: any;
}
