import { IsString, IsOptional, IsArray, IsInt, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSpecDto {
  @IsOptional()
  @IsArray()
  targetUsers?: { role: string; description: string }[];

  @IsOptional()
  @IsArray()
  coreFunctions?: { name: string; description: string; priority: 'must' | 'nice' | 'later' }[];

  @IsOptional()
  @IsArray()
  outOfScope?: { name: string; reason: string }[];

  @IsOptional()
  @IsArray()
  pages?: { name: string; route: string; description: string }[];

  @IsOptional()
  @IsArray()
  roles?: { name: string; permissions: string[] }[];

  @IsOptional()
  @IsArray()
  dataModels?: { name: string; fields: { name: string; type: string; required: boolean }[] }[];

  @IsOptional()
  @IsArray()
  businessRules?: { name: string; description: string; trigger: string; outcome: string }[];

  @IsOptional()
  @IsArray()
  acceptanceScenarios?: { name: string; given: string; when: string; then: string; priority: string }[];

  @IsOptional()
  @IsInt()
  estimatedCostRmb?: number;

  @IsOptional()
  @IsInt()
  estimatedDays?: number;

  @IsOptional()
  @IsArray()
  primaryRisks?: { name: string; severity: string; description: string }[];
}

export class UpdateSpecDto {
  @IsOptional()
  @IsArray()
  targetUsers?: { role: string; description: string }[];

  @IsOptional()
  @IsArray()
  coreFunctions?: { name: string; description: string; priority: 'must' | 'nice' | 'later' }[];

  @IsOptional()
  @IsArray()
  outOfScope?: { name: string; reason: string }[];

  @IsOptional()
  @IsArray()
  pages?: { name: string; route: string; description: string }[];

  @IsOptional()
  @IsArray()
  roles?: { name: string; permissions: string[] }[];

  @IsOptional()
  @IsArray()
  dataModels?: { name: string; fields: { name: string; type: string; required: boolean }[] }[];

  @IsOptional()
  @IsArray()
  businessRules?: { name: string; description: string; trigger: string; outcome: string }[];

  @IsOptional()
  @IsArray()
  acceptanceScenarios?: { name: string; given: string; when: string; then: string; priority: string }[];

  @IsOptional()
  @IsInt()
  estimatedCostRmb?: number;

  @IsOptional()
  @IsInt()
  estimatedDays?: number;

  @IsOptional()
  @IsArray()
  primaryRisks?: { name: string; severity: string; description: string }[];
}

export class FreezeSpecDto {
  @IsString()
  @IsIn(['confirm', 'revise'])
  action!: 'confirm' | 'revise';

  @IsOptional()
  @IsString()
  reviseNote?: string;
}
