import { IsString, IsOptional, IsArray, IsNumber } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  type!: string;

  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  moduleKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acceptanceCriteria?: string[];

  @IsOptional()
  @IsNumber()
  priority?: number;
}
