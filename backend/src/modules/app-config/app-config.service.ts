import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfiguration } from './entities/app-configuration.entity';

export interface AppFeaturesSettings {
  voiceCallsEnabled: boolean;
  videoCallsEnabled: boolean;
  updatedAt: string;
}

export interface AppFeaturesUpdate {
  voiceCallsEnabled?: boolean;
  videoCallsEnabled?: boolean;
}

/**
 * Hot-reloadable application feature flags. Cached in memory; invalidated on update.
 */
@Injectable()
export class AppConfigService implements OnModuleInit {
  private readonly logger = new Logger(AppConfigService.name);
  private cache: AppConfiguration | null = null;
  private cacheLoadedAt = 0;
  private readonly cacheTtlMs = 5_000;

  constructor(
    @InjectRepository(AppConfiguration)
    private readonly configRepo: Repository<AppConfiguration>,
  ) {}

  async onModuleInit() {
    await this.getConfig();
  }

  async getConfig(forceRefresh = false): Promise<AppConfiguration> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cache &&
      now - this.cacheLoadedAt < this.cacheTtlMs
    ) {
      return this.cache;
    }

    let config = await this.configRepo
      .find({
        order: { createdAt: 'ASC' },
        take: 1,
      })
      .then((rows) => rows[0] ?? null);

    if (!config) {
      config = await this.configRepo.save(this.configRepo.create({}));
      this.logger.log('Created default app configuration');
    }

    this.cache = config;
    this.cacheLoadedAt = now;
    return config;
  }

  invalidateCache() {
    this.cache = null;
    this.cacheLoadedAt = 0;
  }

  async getFeatures(): Promise<AppFeaturesSettings> {
    const config = await this.getConfig();
    return this.toPublic(config);
  }

  async updateFeatures(input: AppFeaturesUpdate): Promise<AppFeaturesSettings> {
    const config = await this.getConfig(true);

    if (input.voiceCallsEnabled !== undefined) {
      config.voiceCallsEnabled = input.voiceCallsEnabled;
    }
    if (input.videoCallsEnabled !== undefined) {
      config.videoCallsEnabled = input.videoCallsEnabled;
    }

    const saved = await this.configRepo.save(config);
    this.invalidateCache();
    this.cache = saved;
    this.cacheLoadedAt = Date.now();
    return this.toPublic(saved);
  }

  toPublic(config: AppConfiguration): AppFeaturesSettings {
    return {
      voiceCallsEnabled: config.voiceCallsEnabled,
      videoCallsEnabled: config.videoCallsEnabled,
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}
