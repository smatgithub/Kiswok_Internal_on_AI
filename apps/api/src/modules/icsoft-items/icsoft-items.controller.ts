import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IcsoftItemsService } from './icsoft-items.service';

class ItemOptionsQueryDto {
  @IsOptional()
  @IsString()
  categories?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

class GridBodyDto {
  @IsArray()
  @IsString({ each: true })
  selectedGrnTypes!: string[];

  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  selectedRawMatIds!: number[];

  @IsOptional()
  @IsBoolean()
  allItems?: boolean;
}

@Controller('icsoft-items')
@UseGuards(JwtAuthGuard)
export class IcsoftItemsController {
  constructor(private readonly items: IcsoftItemsService) {}

  @Get('categories')
  async categories() {
    const data = await this.items.getCategories();
    return { success: true, data };
  }

  @Get('options')
  async options(@Query() query: ItemOptionsQueryDto) {
    const selected = (query.categories || 'ALL')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const data = await this.items.getItemOptions(selected, query.q || '');
    return { success: true, data };
  }

  @Get('detail/:rawMatId')
  async detail(@Param('rawMatId') rawMatId: string) {
    const data = await this.items.getItemDetail(Number(rawMatId));
    return { success: true, data };
  }

  @Post('grid')
  async grid(@Body() body: GridBodyDto) {
    const data = await this.items.getItemGrid({
      selectedGrnTypes: body.selectedGrnTypes?.length
        ? body.selectedGrnTypes
        : ['ALL'],
      selectedRawMatIds: body.selectedRawMatIds || [],
      allItems: Boolean(body.allItems),
    });
    return { success: true, data, count: data.length };
  }
}
