import { IsString, IsOptional, IsObject } from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  resultPayload?: Record<string, any>;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}
