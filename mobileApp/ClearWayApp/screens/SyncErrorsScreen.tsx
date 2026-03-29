import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { DatabaseService } from '../services/database.service';
import { SyncService } from '../services/sync.service';

type SyncErrorsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SyncErrors'>;

interface Props {
  navigation: SyncErrorsScreenNavigationProp;
}

export interface ErrorSessionGroup {
  session_id: string;
  count: number;
  error_message: string | null;
  first_error_at: string | null;
}

export const SyncErrorsScreen: React.FC<Props> = ({ navigation }) => {
  const [errorGroups, setErrorGroups] = useState<ErrorSessionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryingSessionId, setRetryingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const loadErrorGroups = useCallback(async () => {
    try {
      const groups = await DatabaseService.getErrorSessionGroups();
      setErrorGroups(groups);
    } catch (error) {
      console.error('Failed to load error groups:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadErrorGroups();
  }, [loadErrorGroups]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadErrorGroups();
  }, [loadErrorGroups]);

  const handleRetry = async (sessionId: string) => {
    try {
      setRetryingSessionId(sessionId);
      
      // Reset error records for this session back to unsynced state
      const count = await DatabaseService.retryErrorRecordsBySession(sessionId);
      
      if (count > 0) {
        console.log(`✓ Reset ${count} error records for session ${sessionId}`);
        
        // Trigger immediate sync for this session
        await SyncService.forceSync();
        
        // Reload the list
        await loadErrorGroups();
      }
    } catch (error) {
      console.error('Failed to retry session:', error);
    } finally {
      setRetryingSessionId(null);
    }
  };

  const handleDelete = (sessionId: string, count: number) => {
    const sessionIdShort = sessionId.substring(0, 8);
    
    Alert.alert(
      'Smazat chybová data',
      `Opravdu chcete smazat ${count} ${count === 1 ? 'záznam' : count < 5 ? 'záznamy' : 'záznamů'} z jízdy ${sessionIdShort}...?\n\nTato akce je nevratná.`,
      [
        {
          text: 'Zrušit',
          style: 'cancel',
        },
        {
          text: 'Smazat',
          style: 'destructive',
          onPress: () => confirmDelete(sessionId),
        },
      ]
    );
  };

  const confirmDelete = async (sessionId: string) => {
    try {
      setDeletingSessionId(sessionId);
      
      // Delete error records for this session
      const count = await DatabaseService.deleteErrorRecordsBySession(sessionId);
      
      if (count > 0) {
        console.log(`🗑️ Deleted ${count} error records for session ${sessionId}`);
        
        // Reload the list
        await loadErrorGroups();
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      Alert.alert('Chyba', 'Nepodařilo se smazat data. Zkuste to znovu.');
    } finally {
      setDeletingSessionId(null);
    }
  };

  const renderErrorCard = ({ item }: { item: ErrorSessionGroup }) => {
    const isRetrying = retryingSessionId === item.session_id;
    const isDeleting = deletingSessionId === item.session_id;
    const isProcessing = isRetrying || isDeleting;
    const sessionIdShort = item.session_id.substring(0, 8);
    const errorDate = item.first_error_at 
      ? new Date(item.first_error_at).toLocaleString('cs-CZ')
      : 'Neznámé datum';

    return (
      <View style={styles.errorCard}>
        <View style={styles.errorHeader}>
          <View>
            <Text style={styles.sessionId}>Jízda {sessionIdShort}...</Text>
            <Text style={styles.errorDate}>{errorDate}</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{item.count}</Text>
          </View>
        </View>
        
        {item.error_message && (
          <View style={styles.errorMessageBox}>
            <Text style={styles.errorMessageLabel}>Chyba:</Text>
            <Text style={styles.errorMessage} numberOfLines={2}>
              {item.error_message}
            </Text>
          </View>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.retryButton, isProcessing && styles.buttonDisabled]}
            onPress={() => handleRetry(item.session_id)}
            disabled={isProcessing}
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.retryButtonText}>Zkusit znovu</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteButton, isProcessing && styles.buttonDisabled]}
            onPress={() => handleDelete(item.session_id, item.count)}
            disabled={isProcessing}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#dc2626" />
            ) : (
              <Text style={styles.deleteButtonText}>Smazat</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.checkmarkCircle}>
        <Text style={styles.checkmark}>✓</Text>
      </View>
      <Text style={styles.emptyTitle}>Vše v pořádku</Text>
      <Text style={styles.emptySubtitle}>
        Všechna data jsou úspěšně odeslána na server
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Zpět</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Neodeslaná data</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#18181b" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Zpět</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Neodeslaná data</Text>
      </View>

      {errorGroups.length === 0 ? (
        <View style={styles.content}>
          {renderEmptyState()}
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Nalezeno {errorGroups.length} {errorGroups.length === 1 ? 'problémová jízda' : 'problémové jízdy'} s chybami při odesílání
            </Text>
          </View>

          <FlatList
            data={errorGroups}
            keyExtractor={(item) => item.session_id}
            renderItem={renderErrorCard}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
            }
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  header: {
    backgroundColor: '#fff',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
  },
  backButton: {
    marginBottom: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#3b82f6',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#18181b',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBox: {
    backgroundColor: '#fef3c7',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    padding: 16,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#92400e',
  },
  listContent: {
    padding: 20,
  },
  errorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  errorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  sessionId: {
    fontSize: 16,
    fontWeight: '600',
    color: '#18181b',
    marginBottom: 4,
  },
  errorDate: {
    fontSize: 12,
    color: '#71717a',
  },
  countBadge: {
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  countText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#dc2626',
  },
  errorMessageBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorMessageLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#991b1b',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 14,
    color: '#dc2626',
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  retryButton: {
    flex: 1,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#dc2626',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  checkmarkCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkmark: {
    fontSize: 48,
    color: '#16a34a',
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#18181b',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 24,
  },
});
